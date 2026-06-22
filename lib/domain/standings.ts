import type { Match, MatchEvent, Team } from '@/lib/supabase/types';

/**
 * Group standings with the FULL FIFA tiebreaker ladder.
 *
 * The SQL view `v_standings` only sorts points → GD → GF, because the
 * remaining criteria require recomputing a mini-table over the subset of
 * matches played *between the tied teams* — awkward in a single view, natural
 * here. FIFA 2026 group tiebreakers, in order:
 *   1. Points
 *   2. Goal difference (all group matches)
 *   3. Goals scored (all group matches)
 *   4. Points in matches between tied teams        (head-to-head)
 *   5. Goal difference in matches between tied teams
 *   6. Goals scored in matches between tied teams
 *   7. Fair play points (yellow −1, second yellow −3, direct red −4,
 *      yellow + direct red −5)
 *   8. Drawing of lots — we substitute fifa_rank (deterministic) and flag it.
 */

export interface TeamStanding {
  team: Team;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  gd: number;
  points: number;
  fairPlay: number;
  /** 1..4 within the group after all tiebreakers */
  rank: number;
}

interface Stats {
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  points: number;
}

const emptyStats = (): Stats => ({
  played: 0,
  won: 0,
  drawn: 0,
  lost: 0,
  gf: 0,
  ga: 0,
  points: 0,
});

function accumulate(stats: Stats, gf: number, ga: number) {
  stats.played += 1;
  stats.gf += gf;
  stats.ga += ga;
  if (gf > ga) {
    stats.won += 1;
    stats.points += 3;
  } else if (gf === ga) {
    stats.drawn += 1;
    stats.points += 1;
  } else {
    stats.lost += 1;
  }
}

/** Build per-team stats over an arbitrary subset of finished matches. */
function buildTable(teamIds: Set<string>, matches: Match[]): Map<string, Stats> {
  const table = new Map<string, Stats>();
  teamIds.forEach((id) => table.set(id, emptyStats()));
  for (const m of matches) {
    if (m.status !== 'finished' || m.home_score == null || m.away_score == null) continue;
    if (!m.home_team_id || !m.away_team_id) continue;
    if (!teamIds.has(m.home_team_id) || !teamIds.has(m.away_team_id)) continue;
    accumulate(table.get(m.home_team_id)!, m.home_score, m.away_score);
    accumulate(table.get(m.away_team_id)!, m.away_score, m.home_score);
  }
  return table;
}

/** FIFA fair-play deductions from the match events jsonb. */
function fairPlayPoints(teamId: string, matches: Match[]): number {
  let pts = 0;
  for (const m of matches) {
    if (m.status !== 'finished') continue;
    const side =
      m.home_team_id === teamId ? 'home' : m.away_team_id === teamId ? 'away' : null;
    if (!side) continue;
    const events: MatchEvent[] = Array.isArray(m.events) ? m.events : [];
    // Track per-player card sequences to score combinations correctly.
    const cardsByPlayer = new Map<string, MatchEvent['type'][]>();
    for (const ev of events) {
      if (ev.team !== side) continue;
      if (ev.type === 'yellow' || ev.type === 'red' || ev.type === 'second_yellow') {
        const key = ev.player ?? `unknown-${ev.minute}`;
        const list = cardsByPlayer.get(key) ?? [];
        list.push(ev.type);
        cardsByPlayer.set(key, list);
      }
    }
    cardsByPlayer.forEach((cards) => {
      const hasSecondYellow = cards.includes('second_yellow');
      const hasDirectRed = cards.includes('red');
      const hasYellow = cards.includes('yellow');
      if (hasSecondYellow) pts -= 3;
      else if (hasDirectRed && hasYellow) pts -= 5;
      else if (hasDirectRed) pts -= 4;
      else if (hasYellow) pts -= 1 * cards.filter((c) => c === 'yellow').length;
    });
  }
  return pts;
}

/**
 * Sort a cluster of teams that are tied on points+GD+GF, applying the
 * head-to-head mini-table (criteria 4–6), then fair play, then fifa_rank.
 */
function breakTie(cluster: Team[], groupMatches: Match[]): Team[] {
  if (cluster.length < 2) return cluster;
  const ids = new Set(cluster.map((t) => t.id));
  const h2h = buildTable(ids, groupMatches); // only matches among the tied teams count
  return [...cluster].sort((a, b) => {
    const sa = h2h.get(a.id)!;
    const sb = h2h.get(b.id)!;
    if (sb.points !== sa.points) return sb.points - sa.points;
    if (sb.gf - sb.ga !== sa.gf - sa.ga) return sb.gf - sb.ga - (sa.gf - sa.ga);
    if (sb.gf !== sa.gf) return sb.gf - sa.gf;
    const fpA = fairPlayPoints(a.id, groupMatches);
    const fpB = fairPlayPoints(b.id, groupMatches);
    if (fpB !== fpA) return fpB - fpA; // higher (less negative) is better
    // Final criterion is officially "drawing of lots"; fifa_rank is our
    // deterministic stand-in so the table never flickers between renders.
    return (a.fifa_rank ?? 999) - (b.fifa_rank ?? 999);
  });
}

export function computeGroupStandings(
  group: string,
  teams: Team[],
  matches: Match[]
): TeamStanding[] {
  const groupTeams = teams.filter((t) => t.group === group);
  const groupMatches = matches.filter((m) => m.stage === 'group' && m.group === group);
  const ids = new Set(groupTeams.map((t) => t.id));
  const table = buildTable(ids, groupMatches);

  // Primary sort: points → GD → GF (criteria 1–3).
  const sorted = [...groupTeams].sort((a, b) => {
    const sa = table.get(a.id)!;
    const sb = table.get(b.id)!;
    if (sb.points !== sa.points) return sb.points - sa.points;
    if (sb.gf - sb.ga !== sa.gf - sa.ga) return sb.gf - sb.ga - (sa.gf - sa.ga);
    return sb.gf - sa.gf;
  });

  // Find clusters still tied on all three primary criteria and re-sort each
  // cluster with the head-to-head ladder.
  const result: Team[] = [];
  let i = 0;
  while (i < sorted.length) {
    const cluster = [sorted[i]];
    const si = table.get(sorted[i].id)!;
    let j = i + 1;
    while (j < sorted.length) {
      const sj = table.get(sorted[j].id)!;
      if (
        sj.points === si.points &&
        sj.gf - sj.ga === si.gf - si.ga &&
        sj.gf === si.gf
      ) {
        cluster.push(sorted[j]);
        j++;
      } else break;
    }
    result.push(...breakTie(cluster, groupMatches));
    i = j;
  }

  return result.map((team, idx) => {
    const s = table.get(team.id)!;
    return {
      team,
      played: s.played,
      won: s.won,
      drawn: s.drawn,
      lost: s.lost,
      gf: s.gf,
      ga: s.ga,
      gd: s.gf - s.ga,
      points: s.points,
      fairPlay: fairPlayPoints(team.id, groupMatches),
      rank: idx + 1,
    };
  });
}

/**
 * Mathematical qualification status for a team within its group.
 *   'champion'   — locked 1st place across every remaining-result scenario
 *   'top2'       — locked top-2 (qualified), but 1st vs 2nd may still be open
 *   'eliminated' — cannot finish in the top 3 in any scenario (gugur)
 *   'open'       — not yet decided
 *
 * We treat 3rd place as "still alive" (conservative): whether a 3rd-placed team
 * advances depends on the cross-group best-third race, which isn't decided until
 * all groups finish — so a team that can still reach 3rd is never 'eliminated'.
 */
export type Clinch = 'champion' | 'top2' | 'eliminated' | 'open';

/** The three possible outcomes of a single unplayed match, as (gf, ga) deltas. */
const OUTCOMES: Array<[number, number]> = [
  [1, 0], // home win
  [0, 0], // draw
  [0, 1], // away win
];

/**
 * Classify every team in a group as champion / top2 / eliminated / open by
 * brute-forcing all remaining group fixtures. Each unfinished match has 3
 * outcomes, so the search is 3^|U| with |U| ≤ 6 (≤ 729) — trivial. For each
 * scenario we reuse computeGroupStandings (full FIFA tiebreaker ladder) and
 * track each team's best/worst achievable rank.
 */
export function computeGroupClinch(
  group: string,
  teams: Team[],
  matches: Match[]
): Map<string, Clinch> {
  const groupTeams = teams.filter((t) => t.group === group);
  const groupMatches = matches.filter((m) => m.stage === 'group' && m.group === group);
  const unplayed = groupMatches.filter(
    (m) => m.status !== 'finished' || m.home_score == null || m.away_score == null
  );

  // best[id] = min rank reachable, worst[id] = max rank reachable across scenarios.
  const best = new Map<string, number>();
  const worst = new Map<string, number>();
  const note = (rows: TeamStanding[]) => {
    for (const r of rows) {
      const id = r.team.id;
      best.set(id, Math.min(best.get(id) ?? Infinity, r.rank));
      worst.set(id, Math.max(worst.get(id) ?? 0, r.rank));
    }
  };

  // Enumerate every combination of outcomes for the unplayed matches. We
  // synthesize finished matches with scores that realize each outcome; only the
  // relative result matters for points/GD/GF accumulation in computeGroupStandings.
  const total = OUTCOMES.length ** unplayed.length;
  for (let combo = 0; combo < total; combo++) {
    let n = combo;
    const hypothetical: Match[] = unplayed.map((m) => {
      const [hg, ag] = OUTCOMES[n % OUTCOMES.length];
      n = Math.floor(n / OUTCOMES.length);
      return { ...m, status: 'finished', home_score: hg, away_score: ag } as Match;
    });
    // Replace the unplayed rows with our hypothetical ones, keep the played ones.
    const unplayedIds = new Set(unplayed.map((m) => m.id));
    const scenarioMatches = [
      ...groupMatches.filter((m) => !unplayedIds.has(m.id)),
      ...hypothetical,
    ];
    note(computeGroupStandings(group, teams, scenarioMatches));
  }

  const result = new Map<string, Clinch>();
  for (const t of groupTeams) {
    const b = best.get(t.id) ?? 4;
    const w = worst.get(t.id) ?? 4;
    if (w <= 1) result.set(t.id, 'champion');
    else if (w <= 2) result.set(t.id, 'top2');
    else if (b >= 4) result.set(t.id, 'eliminated');
    else result.set(t.id, 'open');
  }
  return result;
}

/**
 * Position-locked team ids for bracket seeding: the team that has clinched 1st
 * (fills 'W-<G>') and the team that has clinched exactly 2nd (fills 'RU-<G>').
 * A 'top2' team that could still be 1st is intentionally NOT returned as
 * runnerUp — its specific slot isn't decided yet.
 */
export function clinchedGroupSlots(
  group: string,
  teams: Team[],
  matches: Match[]
): { champion?: string; runnerUp?: string } {
  const clinch = computeGroupClinch(group, teams, matches);
  // Re-derive best ranks to distinguish "exactly 2nd" from "1st-or-2nd".
  const out: { champion?: string; runnerUp?: string } = {};
  const groupTeams = teams.filter((t) => t.group === group);
  for (const t of groupTeams) {
    const c = clinch.get(t.id);
    if (c === 'champion') out.champion = t.id;
  }
  // Runner-up is locked only when a top2 team can never be champion. We detect
  // that by checking it stays rank ≥ 2 across scenarios: a champion exists and
  // this team is the unique other top2 whose best rank is 2.
  for (const t of groupTeams) {
    if (clinch.get(t.id) !== 'top2') continue;
    if (isExactlySecond(group, t.id, teams, matches)) out.runnerUp = t.id;
  }
  return out;
}

/** True when team can finish no higher than 2nd and no lower than 2nd. */
function isExactlySecond(
  group: string,
  teamId: string,
  teams: Team[],
  matches: Match[]
): boolean {
  const groupMatches = matches.filter((m) => m.stage === 'group' && m.group === group);
  const unplayed = groupMatches.filter(
    (m) => m.status !== 'finished' || m.home_score == null || m.away_score == null
  );
  let best = Infinity;
  let worst = 0;
  const total = OUTCOMES.length ** unplayed.length;
  const unplayedIds = new Set(unplayed.map((m) => m.id));
  for (let combo = 0; combo < total; combo++) {
    let n = combo;
    const hypothetical: Match[] = unplayed.map((m) => {
      const [hg, ag] = OUTCOMES[n % OUTCOMES.length];
      n = Math.floor(n / OUTCOMES.length);
      return { ...m, status: 'finished', home_score: hg, away_score: ag } as Match;
    });
    const rows = computeGroupStandings(group, teams, [
      ...groupMatches.filter((m) => !unplayedIds.has(m.id)),
      ...hypothetical,
    ]);
    const rank = rows.find((r) => r.team.id === teamId)?.rank ?? 4;
    best = Math.min(best, rank);
    worst = Math.max(worst, rank);
  }
  return best === 2 && worst === 2;
}

export const GROUPS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'] as const;

export function computeAllStandings(
  teams: Team[],
  matches: Match[]
): Map<string, TeamStanding[]> {
  const map = new Map<string, TeamStanding[]>();
  for (const g of GROUPS) map.set(g, computeGroupStandings(g, teams, matches));
  return map;
}

/**
 * Rank all third-placed teams across the 12 groups; the best 8 advance to the
 * round of 32. Criteria: points → GD → GF → fair play → fifa_rank (lots proxy).
 */
export function rankThirdPlaceTeams(
  standings: Map<string, TeamStanding[]>
): TeamStanding[] {
  const thirds: TeamStanding[] = [];
  standings.forEach((rows) => {
    const third = rows.find((r) => r.rank === 3);
    if (third) thirds.push(third);
  });
  return thirds.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.gd !== a.gd) return b.gd - a.gd;
    if (b.gf !== a.gf) return b.gf - a.gf;
    if (b.fairPlay !== a.fairPlay) return b.fairPlay - a.fairPlay;
    return (a.team.fifa_rank ?? 999) - (b.team.fifa_rank ?? 999);
  });
}

/** A group is complete when all 6 of its fixtures are finished. */
export function isGroupComplete(group: string, matches: Match[]): boolean {
  const groupMatches = matches.filter((m) => m.stage === 'group' && m.group === group);
  return groupMatches.length === 6 && groupMatches.every((m) => m.status === 'finished');
}

export function allGroupsComplete(matches: Match[]): boolean {
  return GROUPS.every((g) => isGroupComplete(g, matches));
}
