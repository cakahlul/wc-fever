import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import { joinMatchTeams } from '@/lib/supabase/queries';
import { fetchLiveData } from '@/lib/crawl';
import { crawlSearch, crawlWikipediaLong } from '@/lib/crawl/playwright-adapter';
import { extractJSON } from '@/lib/llm';
import { LIVE_SCORE_EXTRACTION, SQUAD_EXTRACTION, RANKINGS_EXTRACTION } from '@/lib/llm/prompts';
import { matchFixture, matchTeam, type ExtractedLiveScores } from './helpers';
import { generateMatchReview, generateHypeBlurb } from './reviews';
import { resolveBracket } from '@/lib/domain/bracket';
import { isBigMatch } from '@/lib/domain/big-match';

/**
 * Reconcile sweep — every 12h via crontab. Self-healing for anything the
 * 30s live ticks missed:
 *   1. Re-crawl scores for recently finished / stuck-live matches.
 *   2. Generate missing reviews for finished matches + blurbs for big ones.
 *   3. Refresh squads for late call-ups (teams with suspiciously few players).
 *   4. Re-run knockout slot resolution (covers "round completed while live
 *      job was down").
 */

export async function runReconcile() {
  const db = createServiceClient();
  const summary = {
    scoresReconciled: 0,
    reviewsGenerated: 0,
    blurbsGenerated: 0,
    squadsRefreshed: 0,
    bracketUpdates: 0,
    ranksUpdated: 0,
    errors: [] as string[],
  };

  const [{ data: matches }, { data: teams }] = await Promise.all([
    db.from('matches').select('*').order('match_number'),
    db.from('teams').select('*'),
  ]);
  if (!matches || !teams) {
    summary.errors.push('db unavailable');
    return summary;
  }

  const now = Date.now();
  const RECENT_MS = 24 * 60 * 60 * 1000;

  // ---- 1. Re-crawl recent results (finished <24h ago, or stuck on 'live') ----
  const needsRecheck = matches.filter((m) => {
    if (!m.kickoff_utc) return false;
    const age = now - new Date(m.kickoff_utc).getTime();
    if (m.status === 'live' && age > 3 * 60 * 60 * 1000) return true; // stuck live
    return m.status === 'finished' && age < RECENT_MS;
  });
  if (needsRecheck.length > 0) {
    try {
      const text = await fetchLiveData();
      const extracted = await extractJSON<ExtractedLiveScores>(LIVE_SCORE_EXTRACTION, text);
      for (const ex of extracted?.matches ?? []) {
        if (ex.status !== 'finished') continue;
        const home = matchTeam(ex.home, teams);
        const away = matchTeam(ex.away, teams);
        if (!home || !away) continue;
        const found = matchFixture(home, away, needsRecheck);
        if (!found) continue;
        const { match, flipped } = found;
        const update = {
          status: 'finished' as const,
          minute: null,
          home_score: flipped ? ex.away_score : ex.home_score,
          away_score: flipped ? ex.home_score : ex.away_score,
        };
        const { error } = await db.from('matches').update(update).eq('id', match.id);
        if (!error) {
          Object.assign(match, update);
          summary.scoresReconciled++;
        }
      }
    } catch (e) {
      summary.errors.push(`recheck: ${(e as Error).message}`);
    }
  }

  // ---- 2. Missing reviews / hype blurbs ----
  const withTeams = joinMatchTeams(matches, teams);
  const { data: existing } = await db.from('match_reviews').select('match_id, generated_at, source');
  const reviewedAt = new Map((existing ?? []).map((r) => [r.match_id, r.generated_at]));
  const espnReviewed = new Set((existing ?? []).filter((r) => r.source === 'espn').map((r) => r.match_id));
  for (const m of withTeams) {
    try {
      if (m.status === 'finished') {
        // An ESPN recap is authoritative — never regenerate an LLM review over it.
        if (espnReviewed.has(m.id)) continue;
        // A blurb written pre-match doesn't count as the final review —
        // regenerate if the cached row predates full time (match updated_at).
        const cachedAt = reviewedAt.get(m.id);
        const isStale = cachedAt && new Date(cachedAt) < new Date(m.updated_at);
        if (!cachedAt || isStale) {
          if (await generateMatchReview(db, m)) summary.reviewsGenerated++;
        }
      } else if (!reviewedAt.has(m.id) && isBigMatch(m, m.home_team, m.away_team).isBig) {
        if (await generateHypeBlurb(db, m)) summary.blurbsGenerated++;
      }
    } catch (e) {
      summary.errors.push(`review m${m.match_number}: ${(e as Error).message}`);
    }
  }

  // ---- 3. Squad refresh for late call-ups (fewer than 23 players is suspicious) ----
  const { data: playerRows } = await db.from('players').select('id, team_id').range(0, 99999);
  const counts = new Map<string, number>();
  for (const p of playerRows ?? []) counts.set(p.team_id, (counts.get(p.team_id) ?? 0) + 1);
  const thin = teams.filter((t) => (counts.get(t.id) ?? 0) > 0 && (counts.get(t.id) ?? 0) < 23);
  for (const team of thin.slice(0, 4)) {
    // cap per sweep to bound crawl time
    try {
      const text = await crawlSearch(
        `${team.name} national football team squad FIFA World Cup 2026 latest call ups`
      );
      const extracted = await extractJSON<{
        players: Array<{ name: string; shirt_number: number | null; position: string | null; club: string | null; is_captain: boolean }>;
      }>(SQUAD_EXTRACTION, text);
      const players = (extracted?.players ?? []).filter((p) => p.name);
      if (players.length < 20) continue;
      // replace wholesale — squads are small and this keeps numbers consistent
      await db.from('players').delete().eq('team_id', team.id);
      const { error } = await db.from('players').insert(
        players.map((p) => ({
          team_id: team.id,
          name: p.name,
          shirt_number: p.shirt_number,
          position: p.position,
          club: p.club,
          is_captain: !!p.is_captain,
        }))
      );
      if (!error) summary.squadsRefreshed++;
    } catch (e) {
      summary.errors.push(`squad ${team.code}: ${(e as Error).message}`);
    }
  }

  // ---- 4. Knockout slot resolution ----
  for (const u of resolveBracket(teams, matches)) {
    const { id, ...fields } = u;
    const { error } = await db.from('matches').update(fields).eq('id', id);
    if (!error) summary.bracketUpdates++;
  }

  // ---- 5. FIFA rankings refresh (slow-moving — runs each reconcile sweep) ----
  try {
    const text = await crawlWikipediaLong("FIFA Men's World Ranking");
    const extracted = await extractJSON<{ rankings: Array<{ team: string; rank: number }> }>(
      RANKINGS_EXTRACTION,
      text
    );
    for (const r of extracted?.rankings ?? []) {
      if (!Number.isInteger(r.rank) || r.rank < 1) continue;
      const team = matchTeam(r.team, teams);
      if (!team) continue;
      if (team.fifa_rank === r.rank) continue;
      const { error } = await db.from('teams').update({ fifa_rank: r.rank }).eq('id', team.id);
      if (!error) summary.ranksUpdated++;
    }
  } catch (e) {
    summary.errors.push(`rankings: ${(e as Error).message}`);
  }

  return summary;
}
