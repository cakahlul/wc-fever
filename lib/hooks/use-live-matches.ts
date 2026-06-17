'use client';

import { useEffect, useRef, useState } from 'react';
import { getBrowserClient } from '@/lib/supabase/client';
import type { Match } from '@/lib/supabase/types';

/**
 * Keeps a set of matches live in the browser: seeds from server-fetched rows,
 * then streams updates from a Supabase Realtime subscription on `matches`
 * (unfiltered — same behavior on the home grid, /live, and the match detail
 * page). A polling fallback re-reads the table at the server ticker's cadence
 * (5s live / 60s idle) whenever Realtime hasn't delivered a row within that
 * window, so the UI stays fresh even if the channel joins but the publication
 * never emits changes (e.g. `matches` not added to the Realtime publication).
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

  // Timestamp of the last row change actually delivered by Realtime. A joined
  // channel ("SUBSCRIBED" → connected=true) does NOT guarantee deltas: if the
  // `matches` table isn't in the Realtime publication (a common prod misconfig)
  // the socket looks connected but no changes ever arrive. The poll loop below
  // keys off this so it stays active when realtime is silent, regardless of
  // `connected`.
  const lastRealtimeAtRef = useRef(0);

  // Reconcile against the table on mount and whenever the tab regains focus,
  // independent of the websocket. Realtime only delivers changes that happen
  // AFTER subscribe, so it can't replay an already-past write (e.g. a match
  // that finished before this client loaded). Without this a late loader would
  // stay frozen on its stale SSR seed — finished match stuck at "live 85'".
  useEffect(() => {
    const supabase = getBrowserClient();
    if (!supabase) return;
    let cancelled = false;
    const reconcile = async () => {
      const { data } = await supabase.from('matches').select('*');
      if (cancelled || !data) return;
      setMatches((prev) => {
        const byId = new Map(prev.map((m) => [m.id, m]));
        for (const row of data as Match[]) byId.set(row.id, { ...byId.get(row.id), ...row });
        return Array.from(byId.values());
      });
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') reconcile();
    };
    reconcile();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

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
          lastRealtimeAtRef.current = Date.now();
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

  // Polling fallback. Cadence tracks the server ticker (5s live / 60s idle).
  // It fetches whenever Realtime hasn't delivered a row within the last cadence
  // window — NOT merely when the socket is disconnected. A "SUBSCRIBED" channel
  // with the `matches` table missing from the Realtime publication looks
  // connected but never delivers changes (the prod-vs-local discrepancy), so
  // gating on `connected` would freeze the UI on its SSR seed. When realtime is
  // genuinely healthy the steady live deltas keep this self-suppressed, so it
  // adds no load.
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
      const hasLive = matchesRef.current.some((m) => m.status === 'live');
      const cadence = hasLive ? LIVE_POLL_MS : IDLE_POLL_MS;
      const realtimeFresh = Date.now() - lastRealtimeAtRef.current < cadence;
      if (!cancelled && !realtimeFresh) {
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
  }, []);

  return { matches, connected };
}
