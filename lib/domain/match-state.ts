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
 * Goals split by the side they count FOR. Own goals are credited to the
 * opponent so the per-side counts stay in sync with the scoreline.
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
    const side = e.type === 'own_goal' ? (e.team === 'home' ? 'away' : 'home') : e.team;
    const minute = formatMatchMinute(e.minute, e.stoppage) ?? `${e.minute}'`;
    const suffix = e.type === 'penalty' ? ' (P)' : e.type === 'own_goal' ? ' (OG)' : '';
    (side === 'home' ? home : away).push({ player: (e.player?.trim() || 'Goal') + suffix, minute });
  }
  return { home, away };
}

/**
 * Break label for a live match: "HALF TIME" while in the interval, else null.
 * Full time is conveyed separately by status === 'finished'. Derived from the
 * period events the adapter writes with canonical "Half time"/"Second half"
 * details, so it survives the realtime stream without a dedicated column.
 */
export function liveBreakLabel(match: Pick<Match, 'status' | 'events'>): string | null {
  if (match.status !== 'live') return null;
  const evs = match.events ?? [];
  const halfTime = evs.some((e) => e.type === 'period' && /half ?time/i.test(e.detail ?? ''));
  const secondHalf = evs.some((e) => e.type === 'period' && /(second|2nd) half/i.test(e.detail ?? ''));
  return halfTime && !secondHalf ? 'HALF TIME' : null;
}
