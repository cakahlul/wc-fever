import { createClient } from '@supabase/supabase-js';
import { espnFetchSummary, espnFindEvent } from '@/lib/crawl/espn-adapter';

/**
 * Re-fetch and backfill events for finished matches that still have the old
 * buggy team assignment (all 'away').
 *
 * Usage:
 *   export SUPABASE_URL=... SUPABASE_SERVICE_KEY=...
 *   npx tsx scripts/backfill-events.ts
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const { data: matches, error } = await db
    .from('matches')
    .select('id, home_team_id, away_team_id, kickoff_utc, match_number, events')
    .in('status', ['finished', 'live'])
    .not('events', 'is', null);

  if (error) throw error;

  console.log(`${matches?.length ?? 0} matches with events to check\n`);

  let updated = 0;
  let skipped = 0;

  for (const m of matches ?? []) {
    const events = (m.events ?? []) as any[];
    if (!events.length) continue;

    // Check if all events have the same team (old bug)
    const teams = new Set(events.map((e) => e.team));
    if (teams.size > 1) {
      skipped++;
      continue; // already has mixed home/away, skip
    }

    // Get team abbreviations
    const { data: teamsData } = await db
      .from('teams')
      .select('id, code, name')
      .in('id', [m.home_team_id, m.away_team_id]);

    const home = teamsData?.find((t) => t.id === m.home_team_id);
    const away = teamsData?.find((t) => t.id === m.away_team_id);
    if (!home || !away) {
      console.log(`  m${m.match_number}: team data missing, skip`);
      continue;
    }

    // Try to find ESPN event and re-fetch summary
    try {
      const ev = m.kickoff_utc
        ? await espnFindEvent(home.name, away.name, home.code, away.code, m.kickoff_utc)
        : null;

      if (!ev) {
        console.log(`  m${m.match_number}: ESPN event not found, skip`);
        continue;
      }

      const summary = await espnFetchSummary(ev.eventId, ev.homeAbbr, ev.awayAbbr);
      if (!summary || !summary.events.length) {
        console.log(`  m${m.match_number}: no events in ESPN summary, skip`);
        continue;
      }

      const { error: upErr } = await db
        .from('matches')
        .update({
          events: summary.events.map((e) => ({
            minute: e.minute,
            type: e.type,
            team: e.team,
            player: e.player,
            playerOff: e.playerOff,
          })),
        })
        .eq('id', m.id);

      if (upErr) {
        console.log(`  m${m.match_number}: update error: ${upErr.message}`);
      } else {
        const homeCount = summary.events.filter((e) => e.team === 'home').length;
        const awayCount = summary.events.filter((e) => e.team === 'away').length;
        console.log(`  m${m.match_number}: backfilled ${summary.events.length} events (home: ${homeCount}, away: ${awayCount})`);
        updated++;
      }
    } catch (e) {
      console.log(`  m${m.match_number}: error: ${(e as Error).message}`);
    }
  }

  console.log(`\nDone: ${updated} backfilled, ${skipped} ok, ${(matches?.length ?? 0) - updated - skipped} failed`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .then(() => process.exit(0));
