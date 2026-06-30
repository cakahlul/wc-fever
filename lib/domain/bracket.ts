import type { Match, Team } from '@/lib/supabase/types';
import {
  allGroupsComplete,
  clinchedGroupSlots,
  computeAllStandings,
  GROUPS,
  isGroupComplete,
  rankThirdPlaceTeams,
  type TeamStanding,
} from './standings';

/**
 * Knockout bracket slot resolution.
 *
 * Slot grammar (matches supabase/seed.sql):
 *   'W-<G>'   winner of group G
 *   'RU-<G>'  runner-up of group G
 *   '3rd:XYZ' best third-placed team among the listed groups
 *   'W<n>'    winner of knockout match n
 *   'L<n>'    loser of knockout match n (third-place playoff)
 *
 * Third-place allocation: exactly 8 of the 12 third-placed teams qualify.
 * Each of the 8 R32 slots that take a third lists the groups it may receive
 * (FIFA allocation table). We must assign each qualified third to exactly one
 * compatible slot — a perfect matching. We solve it with backtracking: slots
 * in match-number order, candidates in third-place-ranking order, so the
 * search is deterministic and prefers the natural FIFA-style allocation.
 */

export interface BracketContext {
  /** group letter -> ordered standings (only present when group complete) */
  groupResults: Map<string, TeamStanding[]>;
  /**
   * Position-locked teams seeded before a group finishes: slot string
   * ('W-<G>' / 'RU-<G>') -> team that has mathematically clinched that exact
   * position. Lets a confirmed group winner / runner-up drop into the bracket
   * the moment it's certain, not only at group completion.
   */
  clinchedSlots: Map<string, Team>;
  /** '3rd:XYZ' slot string -> resolved third-placed team */
  thirdAssignments: Map<string, Team>;
  /** match_number -> match row (for W<n>/L<n> chains) */
  byNumber: Map<number, Match>;
  teamsById: Map<string, Team>;
}

export function buildBracketContext(teams: Team[], matches: Match[]): BracketContext {
  const standings = computeAllStandings(teams, matches);
  const groupResults = new Map<string, TeamStanding[]>();
  standings.forEach((rows, g) => {
    if (isGroupComplete(g, matches)) groupResults.set(g, rows);
  });

  const byNumber = new Map<number, Match>();
  for (const m of matches) if (m.match_number != null) byNumber.set(m.match_number, m);

  // Seed position-locked teams (champion / exact runner-up) for groups that
  // haven't finished yet — once locked, the slot is certain.
  const teamsById = new Map(teams.map((t) => [t.id, t]));
  const clinchedSlots = new Map<string, Team>();
  for (const g of GROUPS) {
    if (groupResults.has(g)) continue; // complete groups resolve via groupResults
    const { champion, runnerUp } = clinchedGroupSlots(g, teams, matches);
    if (champion && teamsById.get(champion)) clinchedSlots.set(`W-${g}`, teamsById.get(champion)!);
    if (runnerUp && teamsById.get(runnerUp)) clinchedSlots.set(`RU-${g}`, teamsById.get(runnerUp)!);
  }

  const thirdAssignments = new Map<string, Team>();
  // The global third-place ranking only exists once every group has finished.
  if (allGroupsComplete(matches)) {
    const qualified = rankThirdPlaceTeams(standings).slice(0, 8);
    const thirdSlots = matches
      .filter((m) => m.stage === 'r32')
      .flatMap((m) => [m.home_slot, m.away_slot])
      .filter((s): s is string => !!s && s.startsWith('3rd:'))
      .sort();
    const assignment = matchThirdsToSlots(thirdSlots, qualified);
    if (assignment) {
      assignment.forEach((standing, slot) => thirdAssignments.set(slot, standing.team));
    }
  }

  return {
    groupResults,
    clinchedSlots,
    thirdAssignments,
    byNumber,
    teamsById,
  };
}

/**
 * Backtracking perfect matching: assign each '3rd:XYZ' slot a distinct
 * qualified third whose group appears in the slot's allowed list.
 */
function matchThirdsToSlots(
  slots: string[],
  qualified: TeamStanding[]
): Map<string, TeamStanding> | null {
  const used = new Set<string>();
  const assignment = new Map<string, TeamStanding>();

  function backtrack(idx: number): boolean {
    if (idx === slots.length) return true;
    const slot = slots[idx];
    const allowed = slot.slice(4); // groups after '3rd:'
    for (const standing of qualified) {
      const g = standing.team.group;
      if (!g || used.has(standing.team.id) || !allowed.includes(g)) continue;
      used.add(standing.team.id);
      assignment.set(slot, standing);
      if (backtrack(idx + 1)) return true;
      used.delete(standing.team.id);
      assignment.delete(slot);
    }
    return false;
  }

  return backtrack(0) ? assignment : null;
}

/**
 * Resolve one slot to a team, or null if the prerequisite result isn't in yet.
 * `pickOverride` lets the simulator inject hypothetical winners by match number.
 */
export function resolveSlot(
  slot: string | null,
  ctx: BracketContext,
  pickOverride?: (matchNumber: number) => Team | null
): Team | null {
  if (!slot) return null;

  if (slot.startsWith('W-')) {
    return (
      ctx.groupResults.get(slot.slice(2))?.[0]?.team ??
      ctx.clinchedSlots.get(slot) ??
      null
    );
  }
  if (slot.startsWith('RU-')) {
    return (
      ctx.groupResults.get(slot.slice(3))?.[1]?.team ??
      ctx.clinchedSlots.get(slot) ??
      null
    );
  }
  if (slot.startsWith('3rd:')) {
    return ctx.thirdAssignments.get(slot) ?? null;
  }

  const winnerOf = slot.match(/^W(\d+)$/);
  const loserOf = slot.match(/^L(\d+)$/);
  const ref = winnerOf ?? loserOf;
  if (ref) {
    const num = parseInt(ref[1], 10);
    const m = ctx.byNumber.get(num);
    // Simulator path: a pick on match `num` settles both its winner AND its
    // loser (the other entrant). Slots only reference earlier matches, so the
    // recursive entrant resolution always terminates.
    if (pickOverride && m && m.status !== 'finished') {
      const picked = pickOverride(num);
      if (picked) {
        if (winnerOf) return picked;
        const home = m.home_team_id
          ? ctx.teamsById.get(m.home_team_id) ?? null
          : resolveSlot(m.home_slot, ctx, pickOverride);
        const away = m.away_team_id
          ? ctx.teamsById.get(m.away_team_id) ?? null
          : resolveSlot(m.away_slot, ctx, pickOverride);
        if (home && away) return picked.id === home.id ? away : home;
        return null;
      }
    }
    if (!m || m.status !== 'finished' || m.home_score == null || m.away_score == null) {
      return null;
    }
    // The stored score includes extra time. A knockout tie is then decided on
    // penalties (home_pens/away_pens); fall back to those when the score is
    // level, and treat a still-level result as unresolved rather than guessing.
    let homeWon: boolean;
    if (m.home_score !== m.away_score) {
      homeWon = m.home_score > m.away_score;
    } else if (m.home_pens != null && m.away_pens != null && m.home_pens !== m.away_pens) {
      homeWon = m.home_pens > m.away_pens;
    } else {
      return null;
    }
    const wantWinner = !!winnerOf;
    const teamId = wantWinner === homeWon ? m.home_team_id : m.away_team_id;
    return teamId ? ctx.teamsById.get(teamId) ?? null : null;
  }

  return null;
}

/**
 * Compute home/away team assignments for every knockout match that can now be
 * resolved from real results. Used by the reconcile job to persist them.
 */
export function resolveBracket(
  teams: Team[],
  matches: Match[]
): Array<{ id: string; home_team_id?: string; away_team_id?: string }> {
  const ctx = buildBracketContext(teams, matches);
  const updates: Array<{ id: string; home_team_id?: string; away_team_id?: string }> = [];

  for (const m of matches) {
    if (m.stage === 'group') continue;
    const update: { id: string; home_team_id?: string; away_team_id?: string } = {
      id: m.id,
    };
    let changed = false;
    if (!m.home_team_id) {
      const home = resolveSlot(m.home_slot, ctx);
      if (home) {
        update.home_team_id = home.id;
        changed = true;
      }
    }
    if (!m.away_team_id) {
      const away = resolveSlot(m.away_slot, ctx);
      if (away) {
        update.away_team_id = away.id;
        changed = true;
      }
    }
    if (changed) updates.push(update);
  }
  return updates;
}

/** Human label for an unresolved slot, e.g. 'Winner Group E', 'Best 3rd (A/B/C/D/F)'. */
export function slotLabel(slot: string | null): string {
  if (!slot) return 'TBD';
  if (slot.startsWith('W-')) return `Winner Group ${slot.slice(2)}`;
  if (slot.startsWith('RU-')) return `Runner-up Group ${slot.slice(3)}`;
  if (slot.startsWith('3rd:')) return `Best 3rd (${slot.slice(4).split('').join('/')})`;
  const w = slot.match(/^W(\d+)$/);
  if (w) return `Winner M${w[1]}`;
  const l = slot.match(/^L(\d+)$/);
  if (l) return `Loser M${l[1]}`;
  return slot;
}
