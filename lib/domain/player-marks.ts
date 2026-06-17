import type { MatchEvent } from '@/lib/supabase/types';

/**
 * Per-player in-game annotations derived from a match's event feed: goals,
 * own goals, cards, and substitution timing. The lineups table's `role` is
 * frozen at the pre-kickoff snapshot and the adapter's subbedIn/subbedOut
 * flags are not persisted, so the live truth for "who scored / came on / went
 * off" lives only on `match.events` — which streams in realtime and is
 * backfilled by the tick after full time.
 *
 * Names are matched fuzzily on purpose: goal/card events carry names parsed
 * from ESPN commentary, subs carry `participant.displayName` (often an initial
 * + surname), while lineups/boxscore carry `athlete.fullName`. We reconcile on
 * accent-stripped surname plus a first-name/initial compatibility check.
 */

export interface PlayerMarks {
  goals: string[];
  ownGoals: string[];
  /** Missed penalties + VAR-disallowed goals — rendered with a ❌. */
  crosses: string[];
  yellows: string[];
  reds: string[];
  subIn?: string;
  subOut?: string;
}

export function eventMinute(e: Pick<MatchEvent, 'minute' | 'stoppage'>): string {
  return e.stoppage ? `${e.minute}+${e.stoppage}'` : `${e.minute}'`;
}

const DIACRITICS = /[̀-ͯ]/g;

function normName(s: string): string {
  return s
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .toLowerCase()
    .replace(/[.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function namesMatch(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const na = normName(a);
  const nb = normName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ta = na.split(' ');
  const tb = nb.split(' ');
  // Surname is the most discriminating token — require it to match.
  if (ta[ta.length - 1] !== tb[tb.length - 1]) return false;
  // One side is surname-only (e.g. "Neymar" vs "Neymar Jr") — accept.
  if (ta.length === 1 || tb.length === 1) return true;
  // Same surname: accept if first names match outright or share an initial
  // ("L. Messi" vs "Lionel Messi").
  if (ta[0] === tb[0]) return true;
  return ta[0][0] === tb[0][0];
}

export function collectMarks(events: MatchEvent[], name: string, side: 'home' | 'away'): PlayerMarks {
  const m: PlayerMarks = { goals: [], ownGoals: [], crosses: [], yellows: [], reds: [] };
  for (const e of events) {
    // Own goals are attributed to the beneficiary team but `player` is the
    // conceding scorer, who sits on the opposite roster — match by name only.
    if (e.type === 'own_goal') {
      if (namesMatch(e.player, name)) m.ownGoals.push(eventMinute(e));
      continue;
    }
    if (e.team !== side) continue;
    switch (e.type) {
      case 'goal':
      case 'penalty':
        if (namesMatch(e.player, name)) m.goals.push(eventMinute(e));
        break;
      case 'penalty_miss':
      case 'goal_disallowed':
        if (namesMatch(e.player, name)) m.crosses.push(eventMinute(e));
        break;
      case 'yellow':
        if (namesMatch(e.player, name)) m.yellows.push(eventMinute(e));
        break;
      case 'red':
      case 'second_yellow':
        if (namesMatch(e.player, name)) m.reds.push(eventMinute(e));
        break;
      case 'sub':
        if (namesMatch(e.player, name)) m.subIn = eventMinute(e);
        if (namesMatch(e.playerOff, name)) m.subOut = eventMinute(e);
        break;
    }
  }
  return m;
}

export function hasEventMarks(m: PlayerMarks): boolean {
  return (
    m.goals.length > 0 ||
    m.ownGoals.length > 0 ||
    m.crosses.length > 0 ||
    m.yellows.length > 0 ||
    m.reds.length > 0
  );
}
