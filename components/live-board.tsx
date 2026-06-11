'use client';

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { getBrowserClient } from '@/lib/supabase/client';
import type { Match, MatchWithTeams, Team } from '@/lib/supabase/types';
import { MatchCard } from './match-card';
import { EmptyState } from './skeleton';

/**
 * Live tab: seeded with server-fetched data, then kept fresh by a Supabase
 * Realtime subscription on `matches` (postgres_changes). No client polling —
 * the crawl job writes to the DB and changes stream straight here.
 */
export function LiveBoard({
  initialMatches,
  teams,
}: {
  initialMatches: Match[];
  teams: Team[];
}) {
  const [matches, setMatches] = useState<Match[]>(initialMatches);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const supabase = getBrowserClient();
    if (!supabase) return;
    const channel = supabase
      .channel('matches')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'matches' },
        (payload) => {
          const updated = payload.new as Match;
          if (!updated?.id) return;
          setMatches((prev) => {
            const idx = prev.findIndex((m) => m.id === updated.id);
            if (idx === -1) return [...prev, updated];
            const next = [...prev];
            next[idx] = { ...next[idx], ...updated };
            return next;
          });
        }
      )
      .subscribe((status) => setConnected(status === 'SUBSCRIBED'));
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

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

      <section aria-labelledby="live-now">
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
