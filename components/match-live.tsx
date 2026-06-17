'use client';

import { useMemo } from 'react';
import { useLiveMatches } from '@/lib/hooks/use-live-matches';
import { useLiveLineups } from '@/lib/hooks/use-live-lineups';
import type { LineupEntry, Match, MatchWithTeams, Player, Team } from '@/lib/supabase/types';
import { MatchScoreboard } from './match-scoreboard';
import { MatchTabs } from './match-tabs';

/**
 * Live wrapper for the match detail page. Owns a single realtime subscription
 * to this match row (via useLiveMatches scoped by id) plus a lineups
 * subscription, then feeds the live data into both the scoreboard and the
 * tabs. Timeline, stats, commentary, odds and gamecast all live on the match
 * row, so they update from the same stream — no separate fetches.
 */
export function MatchLive({
  initialMatch,
  teams,
  initialLineups,
  homeSquad,
  awaySquad,
  reviewBody,
}: {
  initialMatch: Match;
  teams: Team[];
  initialLineups: LineupEntry[];
  homeSquad: Player[];
  awaySquad: Player[];
  reviewBody: string | null;
}) {
  const { matches } = useLiveMatches([initialMatch]);
  const lineups = useLiveLineups(initialMatch.id, initialLineups);
  const teamsById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);

  const match = useMemo<MatchWithTeams>(() => {
    const row = matches.find((m) => m.id === initialMatch.id) ?? initialMatch;
    return {
      ...row,
      home_team: row.home_team_id ? teamsById.get(row.home_team_id) ?? null : null,
      away_team: row.away_team_id ? teamsById.get(row.away_team_id) ?? null : null,
    };
  }, [matches, initialMatch, teamsById]);

  return (
    <>
      <MatchScoreboard match={match} />
      <MatchTabs
        match={match}
        lineups={lineups}
        homeSquad={homeSquad}
        awaySquad={awaySquad}
        reviewBody={reviewBody}
      />
    </>
  );
}
