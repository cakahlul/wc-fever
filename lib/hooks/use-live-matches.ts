'use client';

import { useEffect, useRef, useState } from 'react';
import { getBrowserClient } from '@/lib/supabase/client';
import type { Match } from '@/lib/supabase/types';

/**
 * Keeps a set of matches live in the browser: seeds from server-fetched rows,
 * then streams updates from a Supabase Realtime subscription on `matches`
 * (unfiltered — same behavior on the home grid, /live, and the match detail
 * page). A polling fallback (only while the websocket is down) re-reads the
 * table at the server ticker's cadence — 5s while a match is live, 60s idle.
 *
 * Every consumer shares the singleton browser client and the same unfiltered
 * subscription, so all subscribers see the same writes at the same time —
 * minutes stay in sync across pages. Detail pages seed with a single match and
 * just select it back out; extra rows that stream in are harmless.
 */
const LIVE_POLL_MS = 5_000;
const IDLE_POLL_MS = 60_000;

export function useLiveMatches(
  initialMatches: Match[]
): { matches: Match[]; connected: boolean } {
  const [matches, setMatches] = useState<Match[]>(initialMatches);
  const [connected, setConnected] = useState(false);

  // Mirror latest matches into a ref so the polling loop can pick the cadence
  // (live vs idle) without re-subscribing on every state change.
  const matchesRef = useRef(matches);
  matchesRef.current = matches;

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

  // Polling fallback: only fetches while realtime is down. Cadence tracks the
  // server ticker (5s live / 60s idle) off the current match state.
  useEffect(() => {
    const supabase = getBrowserClient();
    if (!supabase) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const schedule = () => {
      const hasLive = matchesRef.current.some((m) => m.status === 'live');
      timer = setTimeout(poll, hasLive ? LIVE_POLL_MS : IDLE_POLL_MS);
    };
    const poll = async () => {
      if (!cancelled && !connected) {
        const { data } = await supabase.from('matches').select('*');
        if (!cancelled && data) {
          setMatches((prev) => {
            const byId = new Map(prev.map((m) => [m.id, m]));
            for (const row of data as Match[]) byId.set(row.id, { ...byId.get(row.id), ...row });
            return Array.from(byId.values());
          });
        }
      }
      if (!cancelled) schedule();
    };

    schedule();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [connected]);

  return { matches, connected };
}
