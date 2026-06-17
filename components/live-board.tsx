'use client';

import { useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useLiveMatches } from '@/lib/hooks/use-live-matches';
import { useGoalCelebration } from '@/lib/hooks/use-goal-celebration';
import type { Match, MatchWithTeams, Team } from '@/lib/supabase/types';
import { MatchCard } from './match-card';
import { GoalGimmick } from './goal-gimmick';
import { EmptyState } from './skeleton';

/**
 * Live tab: seeded with server-fetched data, then kept fresh by the shared
 * `useLiveMatches` hook (Supabase Realtime on `matches`, with a polling
 * fallback while the websocket is down). The crawl job writes to the DB and
 * changes stream straight here.
 */
export function LiveBoard({
  initialMatches,
  teams,
}: {
  initialMatches: Match[];
  teams: Team[];
}) {
  const { matches, connected } = useLiveMatches(initialMatches);

  const teamsById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const withTeams = useMemo<MatchWithTeams[]>(
    () =>
      matches.map((m) => ({
        ...m,
        home_team: m.home_team_id ? teamsById.get(m.home_team_id) ?? null : null,
        away_team: m.away_team_id ? teamsById.get(m.away_team_id) ?? null : null,
      })),
    [matches, teamsById]
  );

  const now = Date.now();
  const live = withTeams.filter((m) => m.status === 'live');
  const celebration = useGoalCelebration(live);
  const recentlyFinished = withTeams
    .filter(
      (m) =>
        m.status === 'finished' &&
        m.kickoff_utc &&
        now - new Date(m.kickoff_utc).getTime() < 24 * 60 * 60 * 1000
    )
    .sort((a, b) => new Date(b.kickoff_utc!).getTime() - new Date(a.kickoff_utc!).getTime());
  const nextUp = withTeams
    .filter((m) => m.status === 'scheduled' && m.kickoff_utc && new Date(m.kickoff_utc).getTime() > now)
    .sort((a, b) => new Date(a.kickoff_utc!).getTime() - new Date(b.kickoff_utc!).getTime())
    .slice(0, 6);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold">Live</h1>
        <span
          className={`flex items-center gap-1.5 text-xs ${connected ? 'text-pitch-line' : 'text-mist'}`}
        >
          <span
            aria-hidden
            className={`h-2 w-2 rounded-full ${connected ? 'bg-pitch-line' : 'bg-mist'}`}
          />
          {connected ? 'Realtime connected' : 'Connecting…'}
        </span>
      </div>

      <section aria-labelledby="live-now" className="relative">
        <AnimatePresence>
          {celebration && <GoalGimmick celebration={celebration} variant="section" />}
        </AnimatePresence>
        <h2 id="live-now" className="mb-3 flex items-center gap-2 font-display text-lg font-bold">
          <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-live animate-live-pulse" />
          On now
        </h2>
        {live.length === 0 ? (
          <EmptyState title="No matches in play" hint="Scores stream in here the second a game kicks off." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <AnimatePresence mode="popLayout">
              {live.map((m) => (
                <motion.div
                  key={`${m.id}-${m.home_score}-${m.away_score}`}
                  initial={{ scale: 0.97, opacity: 0.6 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 24 }}
                >
                  <MatchCard match={m} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </section>

      {recentlyFinished.length > 0 && (
        <section aria-labelledby="just-finished">
          <h2 id="just-finished" className="mb-3 font-display text-lg font-bold">
            Full time
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recentlyFinished.slice(0, 6).map((m) => (
              <MatchCard key={m.id} match={m} />
            ))}
          </div>
        </section>
      )}

      {nextUp.length > 0 && (
        <section aria-labelledby="up-next">
          <h2 id="up-next" className="mb-3 font-display text-lg font-bold">
            Up next
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {nextUp.map((m) => (
              <MatchCard key={m.id} match={m} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
