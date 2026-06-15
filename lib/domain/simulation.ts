import type { Match, Team } from '@/lib/supabase/types';
import { buildBracketContext, resolveSlot } from './bracket';
import { computeAllStandings, isGroupComplete, GROUPS } from './standings';

/**
 * Tournament simulator.
 *
 * Picks are stored as { "<match_number>": "<team_id>" } for knockout matches
 * 73–104 (mirrors the simulations.picks jsonb shape).
 *
 * R32 entrants come from real results where groups have finished; otherwise we
 * project them from fifa_rank (best rank = group winner, 2nd = runner-up,
 * thirds ranked globally by fifa_rank with the same slot-allocation matching
 * the real bracket uses). This keeps the simulator usable before a ball is
 * kicked and self-corrects as real results land.
 */

/**
 * Picks storage is a single flat Record<string,string> (matches the jsonb column).
 * Key conventions:
 *   "<n>"   = legacy knockout winner team_id (kept for backwards compat).
 *   "k:<n>" = knockout winner team_id (preferred for new writes).
 *   "s:<n>" = group score, encoded as "<home>-<away>" (e.g. "2-0").
 */
export type Picks = Record<string, string>;

export function getKnockoutWinner(picks: Picks, n: number): string | null {
  return picks[`k:${n}`] ?? picks[String(n)] ?? null;
}

export function setKnockoutWinner(picks: Picks, n: number, teamId: string): Picks {
  const next = { ...picks };
  delete next[String(n)]; // collapse legacy key onto the namespaced one
  next[`k:${n}`] = teamId;
  return next;
}

export function clearKnockoutWinner(picks: Picks, n: number): Picks {
  const next = { ...picks };
  delete next[String(n)];
  delete next[`k:${n}`];
  return next;
}

export function getGroupScore(picks: Picks, n: number): [number, number] | null {
  const v = picks[`s:${n}`];
  if (!v) return null;
  const [h, a] = v.split('-').map((x) => Number(x));
  return Number.isInteger(h) && Number.isInteger(a) && h >= 0 && a >= 0 ? [h, a] : null;
}

export function setGroupScore(picks: Picks, n: number, h: number, a: number): Picks {
  return { ...picks, [`s:${n}`]: `${h}-${a}` };
}

export function clearGroupScore(picks: Picks, n: number): Picks {
  const next = { ...picks };
  delete next[`s:${n}`];
  return next;
}

/**
 * Returns a NEW matches array where each unfinished group match with a
 * simulated score is treated as finished. Used by buildSimBracket so the
 * existing standings code can produce projected tables from sim picks.
 */
export function applyGroupSimScores(matches: Match[], picks: Picks): Match[] {
  return matches.map((m) => {
    if (m.stage !== 'group' || m.status === 'finished' || m.match_number == null) return m;
    const score = getGroupScore(picks, m.match_number);
    if (!score) return m;
    return { ...m, status: 'finished', home_score: score[0], away_score: score[1] };
  });
}

export const KNOCKOUT_ORDER: number[] = [
  // R32 → R16 → QF → SF → third place → final; resolution must follow this
  // order because later matches reference earlier winners (W<n>/L<n>).
  73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88,
  89, 90, 91, 92, 93, 94, 95, 96,
  97, 98, 99, 100,
  101, 102,
  103, 104,
];

/**
 * Deterministic seeded RNG (mulberry32). Same seed string → same simulated
 * tournament, so "Auto-simulate" results are reproducible and shareable.
 */
export function mulberry32(seedStr: string): () => number {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Win probability from FIFA rank difference (lower rank = stronger), using an
 * Elo-style logistic. A 20-rank gap ≈ 76% for the stronger side; equal ranks
 * → 50%. Tuned for fun rather than rigour — these are seed heuristics.
 */
export function winProbability(rankA: number | null, rankB: number | null): number {
  const ra = rankA ?? 50;
  const rb = rankB ?? 50;
  return 1 / (1 + Math.pow(10, (ra - rb) / 20));
}

export interface SimBracketMatch {
  match: Match;
  home: Team | null;
  away: Team | null;
  /** team_id picked as winner of this match, if any */
  pickedWinnerId: string | null;
}

/**
 * Build the simulator's view of the knockout bracket: every match 73–104 with
 * entrants resolved from (1) real DB team assignments, (2) real group results,
 * (3) fifa_rank projection, and (4) the user's picks for upstream matches.
 */
export function buildSimBracket(
  teams: Team[],
  matches: Match[],
  picks: Picks
): SimBracketMatch[] {
  // Layer simulated group scores onto matches before building any context.
  // Downstream standings + bracket resolution then operate on the synthetic
  // "what if these picks were the real results" world.
  const simMatches = applyGroupSimScores(matches, picks);
  const ctx = buildBracketContext(teams, simMatches);

  // For groups still incomplete even after sim scores, fall back to fifa_rank.
  const standings = computeAllStandings(teams, simMatches);
  for (const g of GROUPS) {
    if (ctx.groupResults.has(g)) continue;
    const projected = [...teams]
      .filter((t) => t.group === g)
      .sort((a, b) => (a.fifa_rank ?? 999) - (b.fifa_rank ?? 999));
    const rows = standings.get(g) ?? [];
    ctx.groupResults.set(
      g,
      projected.map((team, idx) => ({
        ...(rows.find((r) => r.team.id === team.id) ?? {
          team,
          played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0,
          points: 0, fairPlay: 0, rank: idx + 1,
        }),
        team,
        rank: idx + 1,
      }))
    );
  }

  // Project third-place slots when real allocation isn't available yet:
  // rank all (projected) thirds by fifa_rank, take 8, run the same matching.
  if (ctx.thirdAssignments.size === 0) {
    const thirds = GROUPS.map((g) => ctx.groupResults.get(g)?.[2]?.team).filter(
      (t): t is Team => !!t
    ).sort((a, b) => (a.fifa_rank ?? 999) - (b.fifa_rank ?? 999));
    const thirdSlots = matches
      .filter((m) => m.stage === 'r32')
      .flatMap((m) => [m.home_slot, m.away_slot])
      .filter((s): s is string => !!s && s.startsWith('3rd:'))
      .sort();
    assignProjectedThirds(thirdSlots, thirds.slice(0, 8), ctx.thirdAssignments);
  }

  const teamsById = ctx.teamsById;
  const pickOverride = (n: number): Team | null => {
    const id = picks[String(n)];
    return id ? teamsById.get(id) ?? null : null;
  };

  const knockout = simMatches
    .filter((m) => m.match_number != null && m.match_number >= 73)
    .sort((a, b) => a.match_number! - b.match_number!);

  return knockout.map((m) => {
    const home = m.home_team_id
      ? teamsById.get(m.home_team_id) ?? null
      : resolveSlot(m.home_slot, ctx, pickOverride);
    const away = m.away_team_id
      ? teamsById.get(m.away_team_id) ?? null
      : resolveSlot(m.away_slot, ctx, pickOverride);
    // A real finished result beats a pick.
    let pickedWinnerId: string | null = getKnockoutWinner(picks, m.match_number!);
    if (m.status === 'finished' && m.home_score != null && m.away_score != null) {
      if (m.home_score !== m.away_score) {
        pickedWinnerId =
          m.home_score > m.away_score ? m.home_team_id : m.away_team_id;
      }
    }
    return { match: m, home, away, pickedWinnerId };
  });
}

/** Same backtracking matching as the real bracket, on projected thirds. */
function assignProjectedThirds(
  slots: string[],
  qualified: Team[],
  out: Map<string, Team>
): boolean {
  const used = new Set<string>();
  function backtrack(idx: number): boolean {
    if (idx === slots.length) return true;
    const allowed = slots[idx].slice(4);
    for (const team of qualified) {
      if (!team.group || used.has(team.id) || !allowed.includes(team.group)) continue;
      used.add(team.id);
      out.set(slots[idx], team);
      if (backtrack(idx + 1)) return true;
      used.delete(team.id);
      out.delete(slots[idx]);
    }
    return false;
  }
  return backtrack(0);
}

/**
 * Auto-simulate: fill every unpicked group match (score) and knockout match
 * (winner) using a seeded RNG weighted by FIFA rank. Existing picks and real
 * results are preserved.
 */
export function autoSimulate(
  teams: Team[],
  matches: Match[],
  existingPicks: Picks,
  seed: string
): Picks {
  const rng = mulberry32(seed);
  let picks: Picks = { ...existingPicks };

  // Groups first — scores influence knockout entrants downstream.
  const groupMatches = matches
    .filter((m) => m.stage === 'group' && m.match_number != null)
    .sort((a, b) => a.match_number! - b.match_number!);
  const teamsById = new Map(teams.map((t) => [t.id, t]));
  for (const m of groupMatches) {
    if (m.status === 'finished') continue; // real result preserved
    if (getGroupScore(picks, m.match_number!)) continue; // already picked
    const home = m.home_team_id ? teamsById.get(m.home_team_id) ?? null : null;
    const away = m.away_team_id ? teamsById.get(m.away_team_id) ?? null : null;
    if (!home || !away) continue;
    const [hg, ag] = sampleScore(home.fifa_rank, away.fifa_rank, rng);
    picks = setGroupScore(picks, m.match_number!, hg, ag);
  }

  // Knockouts: walk KNOCKOUT_ORDER so each round feeds the next.
  for (const num of KNOCKOUT_ORDER) {
    const bracket = buildSimBracket(teams, matches, picks);
    const sim = bracket.find((b) => b.match.match_number === num);
    if (!sim) continue;
    if (sim.pickedWinnerId) continue; // real result or manual pick
    if (!sim.home || !sim.away) continue;
    const pHome = winProbability(sim.home.fifa_rank, sim.away.fifa_rank);
    picks = setKnockoutWinner(picks, num, rng() < pHome ? sim.home.id : sim.away.id);
  }
  return picks;
}

/**
 * Sample a score from FIFA rank difference: stronger side scores more on
 * average. Caps each side at 5 so blowouts stay rare but possible.
 */
function sampleScore(rankA: number | null, rankB: number | null, rng: () => number): [number, number] {
  const pA = winProbability(rankA, rankB);
  // Mean goals roughly correlate with win probability; both sides get baseline.
  const meanA = 0.6 + pA * 1.8; // ~0.6–2.4
  const meanB = 0.6 + (1 - pA) * 1.8;
  const pick = (mean: number) => {
    // Cheap Poisson-ish via inverse CDF on a truncated distribution.
    let k = 0;
    let p = Math.exp(-mean);
    let cum = p;
    const u = rng();
    while (u > cum && k < 5) {
      k++;
      p = (p * mean) / k;
      cum += p;
    }
    return k;
  };
  return [pick(meanA), pick(meanB)];
}

/** The champion is whoever is picked (or has won) match 104. */
export function championFromPicks(
  teams: Team[],
  matches: Match[],
  picks: Picks
): Team | null {
  const bracket = buildSimBracket(teams, matches, picks);
  const final = bracket.find((b) => b.match.match_number === 104);
  if (!final?.pickedWinnerId) return null;
  return teams.find((t) => t.id === final.pickedWinnerId) ?? null;
}
