'use client';

import { useEffect, useState } from 'react';
import { getBrowserClient } from '@/lib/supabase/client';
import type { LineupEntry } from '@/lib/supabase/types';

/**
 * Keeps a match's lineup rows live: seeded from the server, then updated by a
 * Supabase Realtime subscription on the `lineups` table. Unfiltered (same as
 * the matches subscription) with client-side filtering by match_id, so it
 * behaves identically to the matches sync. Low-churn — the starting XI is
 * written once ~1h before kickoff — so there is no polling fallback; the
 * server-rendered seed is the floor.
 *
 * Requires the `lineups` table to be added to the Supabase Realtime publication
 * (Database → Publications). Without it the seed still renders, just not live.
 */
export function useLiveLineups(matchId: string, initial: LineupEntry[]): LineupEntry[] {
  const [lineups, setLineups] = useState<LineupEntry[]>(initial);

  useEffect(() => {
    const supabase = getBrowserClient();
    if (!supabase) return;
    const channel = supabase
      .channel('lineups')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'lineups' },
        (payload) => {
          setLineups((prev) => {
            if (payload.eventType === 'DELETE') {
              const oldId = (payload.old as Partial<LineupEntry>)?.id;
              return oldId ? prev.filter((l) => l.id !== oldId) : prev;
            }
            const row = payload.new as LineupEntry;
            if (!row?.id || row.match_id !== matchId) return prev;
            const idx = prev.findIndex((l) => l.id === row.id);
            if (idx === -1) return [...prev, row];
            const next = [...prev];
            next[idx] = { ...next[idx], ...row };
            return next;
          });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [matchId]);

  return lineups;
}
