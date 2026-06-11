'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { ensureAnonSession, getBrowserClient } from '@/lib/supabase/client';
import type { Simulation, Team } from '@/lib/supabase/types';
import { EmptyState, Skeleton } from './skeleton';

/** All of the current (anonymous) user's saved simulations — RLS owner-only. */
export function SavedList({ teams }: { teams: Team[] }) {
  const [sims, setSims] = useState<Simulation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const teamsById = new Map(teams.map((t) => [t.id, t]));

  const load = async () => {
    const supabase = getBrowserClient();
    if (!supabase) {
      setError('Supabase not configured — add your keys to .env.local.');
      setSims([]);
      return;
    }
    setError(null);
    const userId = await ensureAnonSession();
    if (!userId) {
      setError('Could not establish a session.');
      setSims([]);
      return;
    }
    const { data, error: err } = await supabase
      .from('simulations')
      .select('*')
      .order('updated_at', { ascending: false });
    if (err) setError(err.message);
    setSims(data ?? []);
  };

  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = async (id: string) => {
    const supabase = getBrowserClient();
    if (!supabase) return;
    setSims((prev) => prev?.filter((s) => s.id !== id) ?? null);
    const { error: err } = await supabase.from('simulations').delete().eq('id', id);
    if (err) {
      setError(`Delete failed: ${err.message}`);
      load();
    }
  };

  const handleRename = async (sim: Simulation) => {
    const name = window.prompt('Rename simulation', sim.name)?.trim();
    if (!name || name === sim.name) return;
    const supabase = getBrowserClient();
    if (!supabase) return;
    setSims((prev) => prev?.map((s) => (s.id === sim.id ? { ...s, name } : s)) ?? null);
    await supabase.from('simulations').update({ name }).eq('id', sim.id);
  };

  if (sims === null) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center justify-between rounded-lg border border-live/40 bg-live/10 p-3 text-sm">
          <span>{error}</span>
          <button type="button" onClick={load} className="font-bold text-gold-bright underline">
            Retry
          </button>
        </div>
      )}
      {sims.length === 0 && !error ? (
        <EmptyState
          title="No saved brackets yet"
          hint="Head to the Simulator, pick a champion and hit Save."
        />
      ) : (
        <AnimatePresence>
          {sims.map((sim) => {
            const champ = sim.champion_team_id ? teamsById.get(sim.champion_team_id) : null;
            return (
              <motion.div
                key={sim.id}
                layout
                exit={{ opacity: 0, x: -30 }}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-night-50/60 bg-night-200 p-4"
              >
                <div>
                  <p className="font-display font-bold">{sim.name}</p>
                  <p className="text-xs text-mist">
                    {Object.keys(sim.picks ?? {}).length} picks · updated{' '}
                    {new Date(sim.updated_at).toLocaleDateString()}
                  </p>
                  {champ && (
                    <p className="mt-1 text-sm text-gold-bright">
                      🏆 {champ.flag_emoji} {champ.name}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Link
                    href={`/simulator?sim=${sim.id}`}
                    className="rounded-lg bg-pitch-light px-3 py-1.5 text-sm font-bold hover:bg-pitch-line"
                  >
                    Load
                  </Link>
                  <button
                    type="button"
                    onClick={() => handleRename(sim)}
                    aria-label={`Rename ${sim.name}`}
                    className="rounded-lg border border-night-50 bg-night-100 px-3 py-1.5 text-sm hover:border-gold/50"
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(sim.id)}
                    aria-label={`Delete ${sim.name}`}
                    className="rounded-lg border border-night-50 bg-night-100 px-3 py-1.5 text-sm hover:border-live/60 hover:text-live"
                  >
                    Delete
                  </button>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      )}
    </div>
  );
}
