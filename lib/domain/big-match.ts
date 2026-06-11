import type { Match, Team } from '@/lib/supabase/types';

/**
 * Big Match detection — single tunable rule set. A match is "big" when any
 * rule fires; tweak thresholds/rivalries here, everything downstream (badge,
 * hype blurb generation, Home pinning) follows automatically.
 */

const HOST_CODES = new Set(['USA', 'CAN', 'MEX']);

/** Classic rivalries / heavyweight pairings, order-independent. */
const RIVALRIES: Array<[string, string]> = [
  ['BRA', 'ARG'],
  ['ESP', 'POR'],
  ['GER', 'NED'],
  ['ENG', 'GER'],
  ['ENG', 'ARG'],
  ['FRA', 'GER'],
  ['FRA', 'ENG'],
  ['USA', 'MEX'],
  ['ARG', 'URU'],
  ['BRA', 'POR'],
  ['JPN', 'KOR'],
  ['ESP', 'FRA'],
  ['CRO', 'BRA'],
  ['MAR', 'ESP'],
];

const rivalryKeys = new Set(RIVALRIES.map(([a, b]) => [a, b].sort().join('-')));

export interface BigMatchVerdict {
  isBig: boolean;
  reasons: string[];
}

export function isBigMatch(
  match: Pick<Match, 'stage'>,
  home: Team | null,
  away: Team | null
): BigMatchVerdict {
  const reasons: string[] = [];

  // Late knockout rounds are always marquee fixtures.
  if (match.stage === 'qf' || match.stage === 'sf' || match.stage === 'final') {
    reasons.push(
      match.stage === 'final'
        ? 'The World Cup Final'
        : match.stage === 'sf'
          ? 'Semi-final'
          : 'Quarter-final'
    );
  }

  if (home && away) {
    if ((home.fifa_rank ?? 99) <= 10 && (away.fifa_rank ?? 99) <= 10) {
      reasons.push('Top-10 heavyweight clash');
    }
    const key = [home.code, away.code].sort().join('-');
    if (rivalryKeys.has(key)) {
      reasons.push(`Classic rivalry: ${home.name} vs ${away.name}`);
    }
    if (HOST_CODES.has(home.code) || HOST_CODES.has(away.code)) {
      reasons.push('Host nation on home soil');
    }
  }

  return { isBig: reasons.length > 0, reasons };
}
