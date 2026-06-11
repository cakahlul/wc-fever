import 'server-only';
import type { Match, Team } from '@/lib/supabase/types';

/**
 * Shared crawl-job utilities: fuzzy team-name matching between crawled text
 * (which uses media spellings) and our seeded team rows.
 */

const TEAM_ALIASES: Record<string, string> = {
  // crawled spelling (lowercased) -> seeded `teams.name`
  usa: 'United States',
  'united states of america': 'United States',
  'korea republic': 'South Korea',
  korea: 'South Korea',
  turkey: 'Turkiye',
  türkiye: 'Turkiye',
  "cote d'ivoire": 'Ivory Coast',
  "côte d'ivoire": 'Ivory Coast',
  'czech republic': 'Czechia',
  bosnia: 'Bosnia and Herzegovina',
  'bosnia-herzegovina': 'Bosnia and Herzegovina',
  'congo dr': 'DR Congo',
  'dr congo': 'DR Congo',
  'congo, democratic republic': 'DR Congo',
  'cabo verde': 'Cape Verde',
  curaçao: 'Curacao',
  holland: 'Netherlands',
  'ir iran': 'Iran',
};

function normalize(name: string): string {
  return name.toLowerCase().replace(/\./g, '').trim();
}

/** Resolve a crawled team name to a seeded team row, or null. */
export function matchTeam(crawledName: string, teams: Team[]): Team | null {
  const n = normalize(crawledName);
  const aliased = TEAM_ALIASES[n];
  const target = aliased ? normalize(aliased) : n;
  // exact name or code match first
  for (const t of teams) {
    if (normalize(t.name) === target || normalize(t.code) === target) return t;
  }
  // then containment (e.g. "Mexico (MEX)" or "Korea Rep.")
  for (const t of teams) {
    const tn = normalize(t.name);
    if (tn.includes(target) || target.includes(tn)) return t;
  }
  return null;
}

/** Find the DB fixture for a crawled home/away pairing (either orientation). */
export function matchFixture(
  home: Team,
  away: Team,
  matches: Match[]
): { match: Match; flipped: boolean } | null {
  for (const m of matches) {
    if (m.home_team_id === home.id && m.away_team_id === away.id) {
      return { match: m, flipped: false };
    }
    if (m.home_team_id === away.id && m.away_team_id === home.id) {
      return { match: m, flipped: true };
    }
  }
  return null;
}

export interface ExtractedLiveMatch {
  home: string;
  away: string;
  home_score: number | null;
  away_score: number | null;
  minute: number | null;
  status: 'scheduled' | 'live' | 'finished';
}

export interface ExtractedLiveScores {
  matches: ExtractedLiveMatch[];
}
