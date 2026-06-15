import type { Match, Team } from '@/lib/supabase/types';

/**
 * Big Match detection — single tunable rule set. A match is "big" when any
 * rule fires; tweak thresholds/rivalries here, everything downstream (badge,
 * hype blurb generation, Home pinning) follows automatically.
 */

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
  match: Pick<Match, 'stage' | 'match_number'>,
  home: Team | null,
  away: Team | null
): BigMatchVerdict {
  const reasons: string[] = [];

  // Knockout from round-of-16 onward — every round is marquee.
  if (match.stage === 'r32' || match.stage === 'r16' || match.stage === 'qf' || match.stage === 'sf' || match.stage === 'final') {
    reasons.push(
      match.stage === 'final'
        ? 'The World Cup Final'
        : match.stage === 'sf'
          ? 'Semi-final'
          : match.stage === 'qf'
            ? 'Quarter-final'
            : match.stage === 'r16'
              ? 'Round of 16'
              : 'Round of 32'
    );
  }

  // Tournament opener — first match is always a global event.
  if (match.match_number === 1) {
    reasons.push('Tournament opener');
  }

  if (home && away) {
    const homeRank = home.fifa_rank ?? 99;
    const awayRank = away.fifa_rank ?? 99;
    const combined = homeRank + awayRank;
    const diff = Math.abs(homeRank - awayRank);
    const best = Math.min(homeRank, awayRank);

    // Two top-15 sides OR an aggregate top-25 of strong-but-not-elite pairings.
    if ((homeRank <= 15 && awayRank <= 15) || combined <= 25) {
      reasons.push('Heavyweight clash');
    }
    // Top-10 side facing a credible challenger (potential upset / story match).
    else if (best <= 10 && diff <= 20) {
      reasons.push('Giant-killer potential');
    }

    const key = [home.code, away.code].sort().join('-');
    if (rivalryKeys.has(key)) {
      reasons.push(`Classic rivalry: ${home.name} vs ${away.name}`);
    }
  }

  return { isBig: reasons.length > 0, reasons };
}
