import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import { joinMatchTeams } from '@/lib/supabase/queries';
import { fetchLiveData, fetchLineupData } from '@/lib/crawl';
import { extractJSON } from '@/lib/llm';
import { LINEUP_EXTRACTION, LIVE_SCORE_EXTRACTION } from '@/lib/llm/prompts';
import { matchFixture, matchTeam, type ExtractedLiveScores } from './helpers';
import { generateMatchReview } from './reviews';
import { resolveBracket } from '@/lib/domain/bracket';

/**
 * Live tick — runs every 30s from the PM2 ticker, but is GATED: it queries
 * the DB first and exits immediately (no Playwright, no LLM) unless a match
 * is live or kicking off within 5 minutes. Most ticks cost one cheap query.
 */

const KICKOFF_LOOKAHEAD_MS = 5 * 60 * 1000;
const LINEUP_WINDOW_MIN_MS = 60 * 60 * 1000; // crawl lineups 60–75 min pre-kickoff
const LINEUP_WINDOW_MAX_MS = 75 * 60 * 1000;

export async function runLiveTick() {
  const db = createServiceClient();
  const now = Date.now();

  const [{ data: matches }, { data: teams }] = await Promise.all([
    db.from('matches').select('*').order('match_number'),
    db.from('teams').select('*'),
  ]);
  if (!matches || !teams) return { skipped: true, reason: 'db unavailable' };

  const liveMatches = matches.filter((m) => m.status === 'live');
  const imminent = matches.filter(
    (m) =>
      m.status === 'scheduled' &&
      m.kickoff_utc &&
      new Date(m.kickoff_utc).getTime() - now <= KICKOFF_LOOKAHEAD_MS &&
      // a match that "kicked off" >3h ago but never went live is stale, not imminent
      now - new Date(m.kickoff_utc).getTime() < 3 * 60 * 60 * 1000
  );

  // Lineup window check happens even without live matches (kickoff -75..-60min).
  const lineupCandidates = matches.filter((m) => {
    if (m.status !== 'scheduled' || !m.kickoff_utc || !m.home_team_id || !m.away_team_id)
      return false;
    const untilKickoff = new Date(m.kickoff_utc).getTime() - now;
    return untilKickoff >= LINEUP_WINDOW_MIN_MS && untilKickoff <= LINEUP_WINDOW_MAX_MS;
  });

  if (liveMatches.length === 0 && imminent.length === 0 && lineupCandidates.length === 0) {
    return { skipped: true, reason: 'no live or imminent matches' };
  }

  const summary = {
    skipped: false,
    scoresUpdated: 0,
    lineupsCrawled: 0,
    reviewsGenerated: 0,
    bracketUpdates: 0,
    errors: [] as string[],
  };

  // ---- live scores: crawl → cleanForLLM (inside adapter) → extractJSON → upsert ----
  if (liveMatches.length > 0 || imminent.length > 0) {
    try {
      const text = await fetchLiveData();
      const extracted = await extractJSON<ExtractedLiveScores>(LIVE_SCORE_EXTRACTION, text);
      const newlyFinished: string[] = [];

      for (const ex of extracted?.matches ?? []) {
        const home = matchTeam(ex.home, teams);
        const away = matchTeam(ex.away, teams);
        if (!home || !away) continue;
        const found = matchFixture(home, away, matches);
        if (!found) continue;
        const { match, flipped } = found;
        // Never resurrect a finished match from a stale crawl.
        if (match.status === 'finished' && ex.status !== 'finished') continue;

        const homeScore = flipped ? ex.away_score : ex.home_score;
        const awayScore = flipped ? ex.home_score : ex.away_score;
        const update = {
          status: ex.status,
          minute: ex.status === 'live' ? ex.minute : null,
          home_score: homeScore,
          away_score: awayScore,
        };
        const { error } = await db.from('matches').update(update).eq('id', match.id);
        if (!error) {
          summary.scoresUpdated++;
          if (ex.status === 'finished' && match.status !== 'finished') {
            newlyFinished.push(match.id);
            Object.assign(match, update); // keep in-memory copy current for bracket resolution
          }
        }
      }

      // newly finished → review + bracket slot resolution
      if (newlyFinished.length > 0) {
        const withTeams = joinMatchTeams(matches, teams);
        for (const id of newlyFinished) {
          const m = withTeams.find((x) => x.id === id);
          if (m && (await generateMatchReview(db, m))) summary.reviewsGenerated++;
        }
        for (const u of resolveBracket(teams, matches)) {
          const { id, ...fields } = u;
          const { error } = await db.from('matches').update(fields).eq('id', id);
          if (!error) summary.bracketUpdates++;
        }
      }
    } catch (e) {
      summary.errors.push(`live scores: ${(e as Error).message}`);
    }
  }

  // ---- lineup crawl (~60–75 min pre-kickoff, only if not stored yet) ----
  for (const m of lineupCandidates) {
    try {
      const { count } = await db
        .from('lineups')
        .select('id', { count: 'exact', head: true })
        .eq('match_id', m.id);
      if ((count ?? 0) > 0) continue; // already crawled

      const home = teams.find((t) => t.id === m.home_team_id)!;
      const away = teams.find((t) => t.id === m.away_team_id)!;
      const text = await fetchLineupData(`${home.name} vs ${away.name}`);
      if (!text) continue;

      interface LineupSide {
        formation: string | null;
        starters: Array<{ name: string; shirt_number: number | null; position: string | null; is_captain?: boolean }>;
        subs: Array<{ name: string; shirt_number: number | null; position: string | null }>;
      }
      const extracted = await extractJSON<{ home: LineupSide | null; away: LineupSide | null }>(
        LINEUP_EXTRACTION,
        text
      );
      if (!extracted?.home || !extracted?.away) continue;
      if (extracted.home.starters.length !== 11 || extracted.away.starters.length !== 11)
        continue; // partial lineups are worse than none

      const { data: squad } = await db
        .from('players')
        .select('*')
        .in('team_id', [home.id, away.id]);
      const rows: any[] = [];
      const pushSide = (side: LineupSide, teamId: string) => {
        for (const role of ['starter', 'sub'] as const) {
          const list = role === 'starter' ? side.starters : side.subs;
          for (const p of list ?? []) {
            if (!p.name) continue;
            const squadPlayer = (squad ?? []).find(
              (sp) => sp.team_id === teamId && sp.name.toLowerCase() === p.name.toLowerCase()
            );
            rows.push({
              match_id: m.id,
              team_id: teamId,
              player_id: squadPlayer?.id ?? null,
              player_name: p.name,
              shirt_number: p.shirt_number,
              position: p.position,
              role,
              is_captain: !!(p as any).is_captain,
              formation: side.formation,
            });
          }
        }
      };
      pushSide(extracted.home, home.id);
      pushSide(extracted.away, away.id);
      const { error } = await db
        .from('lineups')
        .upsert(rows, { onConflict: 'match_id,team_id,player_name' });
      if (!error) summary.lineupsCrawled++;
    } catch (e) {
      summary.errors.push(`lineup m${m.match_number}: ${(e as Error).message}`);
    }
  }

  return summary;
}
