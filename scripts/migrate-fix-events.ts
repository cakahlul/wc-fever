import { createClient } from '@supabase/supabase-js';
import type { MatchEvent } from '@/lib/supabase/types';

/**
 * One-shot migration: fix events.team field that was all set to 'away' by the
 * buggy espn-adapter.ts (ke.team?.abbreviation was null, so ternary always fell
 * to 'away').
 *
 * Set SUPABASE_URL and SUPABASE_SERVICE_KEY env vars, then:
 *   npx tsx scripts/migrate-fix-events.ts
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars');
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

async function main() {
  const { data: matches, error } = await db
    .from('matches')
    .select('id, home_team_id, away_team_id, events, status')
    .not('events', 'is', null);
  if (error) throw error;

  let fixed = 0;
  let skipped = 0;

  for (const m of matches ?? []) {
    const events = (m.events ?? []) as MatchEvent[];
    if (!events.length) continue;

    // Fetch players for both teams
    const { data: players } = await db
      .from('players')
      .select('name, team_id')
      .in('team_id', [m.home_team_id, m.away_team_id]);

    const homePlayers = new Set((players ?? []).filter((p) => p.team_id === m.home_team_id).map((p) => p.name.toLowerCase()));
    const awayPlayers = new Set((players ?? []).filter((p) => p.team_id === m.away_team_id).map((p) => p.name.toLowerCase()));

    const corrected = events.map((e) => {
      const playerLower = e.player?.toLowerCase() ?? '';
      if (playerLower && homePlayers.has(playerLower)) return { ...e, team: 'home' as const };
      if (playerLower && awayPlayers.has(playerLower)) return { ...e, team: 'away' as const };
      // If no player or player not found, keep as-is (likely 'away' from bug)
      return e;
    });

    const changed = corrected.some((e, i) => e.team !== events[i].team);
    if (changed) {
      const { error: upErr } = await db.from('matches').update({ events: corrected }).eq('id', m.id);
      if (upErr) {
        console.error(`Failed to update ${m.id}: ${upErr.message}`);
      } else {
        fixed++;
        console.log(`Fixed ${m.id}: ${events.filter((e, i) => e.team !== corrected[i].team).length} events`);
      }
    } else {
      skipped++;
    }
  }

  console.log(`\nDone: ${fixed} matches fixed, ${skipped} unchanged.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
