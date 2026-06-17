'use client';

import { useMemo } from 'react';
import { useLiveMatches } from '@/lib/hooks/use-live-matches';
import type { Match, MatchWithTeams, Team } from '@/lib/supabase/types';
import { MatchCard } from './match-card';

/**
 * Home-page "Live now" section, kept in sync with the match detail scoreboard
 * and the /live tab via the shared realtime hook. Renders nothing until at
 * least one match is live, so it can also surface a match that kicks off after
 * the page loaded.
 */
export function LiveNowCards({
  initialMatches,
  teams,
}: {
  initialMatches: Match[];
  teams: Team[];
}) {
  const { matches } = useLiveMatches(initialMatches);
  const teamsById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);

  const live = useMemo<MatchWithTeams[]>(
    () =>
      matches
        .filter((m) => m.status === 'live')
        .map((m) => ({
          ...m,
          home_team: m.home_team_id ? teamsById.get(m.home_team_id) ?? null : null,
          away_team: m.away_team_id ? teamsById.get(m.away_team_id) ?? null : null,
        })),
    [matches, teamsById]
  );

  if (live.length === 0) return null;

  return (
    <section aria-labelledby="live-now">
      <h2 id="live-now" className="mb-3 flex items-center gap-2 font-display text-xl font-bold">
        <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-live animate-live-pulse" />
        Live now
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {live.map((m) => (
          <MatchCard key={m.id} match={m} />
        ))}
      </div>
    </section>
  );
}
