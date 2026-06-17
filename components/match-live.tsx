'use client';

import { useMemo } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useLiveMatches } from '@/lib/hooks/use-live-matches';
import { useLiveLineups } from '@/lib/hooks/use-live-lineups';
import { useGoalCelebration } from '@/lib/hooks/use-goal-celebration';
import type { LineupEntry, Match, MatchWithTeams, Player, Team } from '@/lib/supabase/types';
import { MatchScoreboard } from './match-scoreboard';
import { MatchTabs } from './match-tabs';
import { GoalGimmick } from './goal-gimmick';

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
  reviewSource,
}: {
  initialMatch: Match;
  teams: Team[];
  initialLineups: LineupEntry[];
  homeSquad: Player[];
  awaySquad: Player[];
  reviewBody: string | null;
  reviewSource: string | null;
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

  const celebration = useGoalCelebration([match]);

  return (
    <>
      <AnimatePresence>
        {celebration && <GoalGimmick celebration={celebration} variant="page" />}
      </AnimatePresence>
      <MatchScoreboard match={match} />
      <MatchTabs
        match={match}
        lineups={lineups}
        homeSquad={homeSquad}
        awaySquad={awaySquad}
        reviewBody={reviewBody}
        reviewSource={reviewSource}
      />
    </>
  );
}
