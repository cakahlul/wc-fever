import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import { joinMatchTeams } from '@/lib/supabase/queries';
import { crawlSearch } from '@/lib/crawl/playwright-adapter';
import { extractJSON } from '@/lib/llm';
import { SCHEDULE_EXTRACTION, SQUAD_EXTRACTION } from '@/lib/llm/prompts';
import { matchTeam } from './helpers';
import { generateMatchReview, generateHypeBlurb } from './reviews';
import { GROUPS } from '@/lib/domain/standings';
import { isBigMatch } from '@/lib/domain/big-match';

/**
 * Bootstrap job — idempotent backfill, safe to re-run any time:
 *   1. Fill null kickoff_utc/venue on schedule rows (crawl per group).
 *   2. Seed 26-man squads for teams that have no players yet.
 *   3. Generate missing reviews for finished matches and hype blurbs for
 *      upcoming big matches.
 * Everything already present is skipped.
 */

interface ExtractedFixture {
  home: string;
  away: string;
  kickoff_utc: string;
  venue: string | null;
  city: string | null;
}

export async function runBootstrap() {
  const db = createServiceClient();
  const summary = {
    kickoffsFilled: 0,
    squadsSeeded: 0,
    reviewsGenerated: 0,
    blurbsGenerated: 0,
    errors: [] as string[],
  };

  const [{ data: teams }, { data: matches }] = await Promise.all([
    db.from('teams').select('*'),
    db.from('matches').select('*').order('match_number'),
  ]);
  if (!teams || !matches) {
    summary.errors.push('Could not load teams/matches');
    return summary;
  }

  // ---- 1. Schedule backfill (group fixtures missing kickoff_utc) ----
  // Crawl one search per group that still has gaps; match extracted fixtures
  // to rows by team pairing. Knockout kickoffs resolve later (reconcile) once
  // teams are known.
  const groupsWithGaps = GROUPS.filter((g) =>
    matches.some((m) => m.group === g && m.stage === 'group' && !m.kickoff_utc)
  );
  for (const g of groupsWithGaps) {
    try {
      const text = await crawlSearch(
        `FIFA World Cup 2026 Group ${g} fixtures schedule dates kickoff times venues`
      );
      const extracted = await extractJSON<{ fixtures: ExtractedFixture[] }>(
        SCHEDULE_EXTRACTION,
        text
      );
      for (const fx of extracted?.fixtures ?? []) {
        const home = matchTeam(fx.home, teams);
        const away = matchTeam(fx.away, teams);
        if (!home || !away) continue;
        const row = matches.find(
          (m) =>
            m.stage === 'group' &&
            !m.kickoff_utc &&
            ((m.home_team_id === home.id && m.away_team_id === away.id) ||
              (m.home_team_id === away.id && m.away_team_id === home.id))
        );
        if (!row || !fx.kickoff_utc) continue;
        const { error } = await db
          .from('matches')
          .update({
            kickoff_utc: fx.kickoff_utc,
            venue: row.venue ?? fx.venue,
            city: row.city ?? fx.city,
          })
          .eq('id', row.id);
        if (!error) {
          row.kickoff_utc = fx.kickoff_utc;
          summary.kickoffsFilled++;
        }
      }
    } catch (e) {
      summary.errors.push(`schedule group ${g}: ${(e as Error).message}`);
    }
  }

  // ---- 2. Squad seeding (teams with zero players) ----
  const { data: playerCounts } = await db.from('players').select('team_id');
  const teamsWithPlayers = new Set((playerCounts ?? []).map((p) => p.team_id));
  for (const team of teams) {
    if (teamsWithPlayers.has(team.id)) continue; // skip already-seeded squads
    try {
      const text = await crawlSearch(
        `${team.name} national football team 26 man squad FIFA World Cup 2026 list`
      );
      const extracted = await extractJSON<{
        players: Array<{
          name: string;
          shirt_number: number | null;
          position: string | null;
          club: string | null;
          is_captain: boolean;
        }>;
      }>(SQUAD_EXTRACTION, text);
      const players = (extracted?.players ?? []).filter((p) => p.name);
      if (players.length < 11) continue; // implausible squad — try again next run
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
      if (!error) summary.squadsSeeded++;
    } catch (e) {
      summary.errors.push(`squad ${team.code}: ${(e as Error).message}`);
    }
  }

  // ---- 3. Missing reviews + big-match hype blurbs ----
  const withTeams = joinMatchTeams(matches, teams);
  const { data: existingReviews } = await db.from('match_reviews').select('match_id');
  const reviewed = new Set((existingReviews ?? []).map((r) => r.match_id));

  for (const m of withTeams) {
    if (reviewed.has(m.id)) continue;
    try {
      if (m.status === 'finished') {
        if (await generateMatchReview(db, m)) summary.reviewsGenerated++;
      } else if (isBigMatch(m, m.home_team, m.away_team).isBig) {
        if (await generateHypeBlurb(db, m)) summary.blurbsGenerated++;
      }
    } catch (e) {
      summary.errors.push(`review m${m.match_number}: ${(e as Error).message}`);
    }
  }

  return summary;
}
