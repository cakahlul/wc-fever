import type { Match, MatchEvent } from '@/lib/supabase/types';
import { formatMatchMinute } from './minute';

export interface Scorer {
  /** Display name, suffixed with (P) for penalties and (OG) for own goals. */
  player: string;
  /** Pre-formatted minute label, e.g. "23'" or "45+2'". */
  minute: string;
}

const GOAL_TYPES = new Set<MatchEvent['type']>(['goal', 'penalty', 'own_goal']);

/**
 * Goals split by the side they count FOR. ESPN already attributes own-goal
 * events to the beneficiary team (`team` = the side that gets the goal), so we
 * use `e.team` as-is — no flip — keeping per-side counts in sync with the score.
 */
export function goalScorers(events: MatchEvent[] | null | undefined): {
  home: Scorer[];
  away: Scorer[];
} {
  const home: Scorer[] = [];
  const away: Scorer[] = [];
  for (const e of events ?? []) {
    if (!GOAL_TYPES.has(e.type)) continue;
    if (e.team !== 'home' && e.team !== 'away') continue;
    const side = e.team;
    const minute = formatMatchMinute(e.minute, e.stoppage) ?? `${e.minute}'`;
    const suffix = e.type === 'penalty' ? ' (P)' : e.type === 'own_goal' ? ' (OG)' : '';
    (side === 'home' ? home : away).push({ player: (e.player?.trim() || 'Goal') + suffix, minute });
  }
  return { home, away };
}

/**
 * Break label for a live match: "HALF TIME" while in the interval, else null.
 * Full time is conveyed separately by status === 'finished'.
 *
 * The break is over the instant the clock advances past 45' — we do NOT wait
 * for a "Second half" period event. ESPN doesn't always emit one, and a tick
 * that refreshes only `minute` leaves `events` at the last halftime snapshot;
 * relying on that event would pin the label to HALF TIME through the whole
 * second half and hide the running minute.
 */
export function liveBreakLabel(match: Pick<Match, 'status' | 'events' | 'minute'>): string | null {
  if (match.status !== 'live') return null;
  const evs = match.events ?? [];
  const halfTime = evs.some((e) => e.type === 'period' && /half ?time/i.test(e.detail ?? ''));
  if (!halfTime) return null;
  const secondHalf = evs.some((e) => e.type === 'period' && /(second|2nd) half/i.test(e.detail ?? ''));
  const clockAdvanced = match.minute != null && match.minute > 45;
  return secondHalf || clockAdvanced ? null : 'HALF TIME';
}
