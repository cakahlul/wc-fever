import 'server-only';
import { unstable_cache } from 'next/cache';
import { createReadClient } from './server';
import type {
  LineupEntry,
  Match,
  MatchReview,
  MatchWithTeams,
  Player,
  Team,
} from './types';

/**
 * Server-side read queries (anon key, RLS public-read). Teams and matches are
 * tiny (48 + 104 rows) so we fetch whole tables and join in memory — simpler
 * and avoids brittle embedded-select typings.
 *
 * Every query degrades to an empty result when Supabase env vars are missing
 * so the UI renders friendly empty states instead of crashing.
 */

export async function getTeams(): Promise<Team[]> {
  const supabase = createReadClient();
  if (!supabase) return [];
  const { data, error } = await supabase.from('teams').select('*').order('name');
  if (error) {
    console.error('getTeams failed:', error.message);
    return [];
  }
  return data ?? [];
}

export function joinMatchTeams(matches: Match[], teams: Team[]): MatchWithTeams[] {
  const byId = new Map(teams.map((t) => [t.id, t]));
  return matches.map((m) => ({
    ...m,
    home_team: m.home_team_id ? byId.get(m.home_team_id) ?? null : null,
    away_team: m.away_team_id ? byId.get(m.away_team_id) ?? null : null,
  }));
}

export async function getMatchesWithTeams(): Promise<{
  matches: MatchWithTeams[];
  teams: Team[];
}> {
  const supabase = createReadClient();
  if (!supabase) return { matches: [], teams: [] };
  const [matchesRes, teamsRes] = await Promise.all([
    supabase.from('matches').select('*').order('match_number'),
    supabase.from('teams').select('*'),
  ]);
  if (matchesRes.error || teamsRes.error) {
    console.error(
      'getMatchesWithTeams failed:',
      matchesRes.error?.message ?? teamsRes.error?.message
    );
    return { matches: [], teams: [] };
  }
  const teams = teamsRes.data ?? [];
  return { matches: joinMatchTeams(matchesRes.data ?? [], teams), teams };
}

/**
 * Per-match detail reads are cached and invalidated by the live tick
 * (lib/jobs/live.ts → revalidateTag('match:<id>' | 'lineups:<id>' | 'review:<id>')).
 * Between ticks the match page is served from Next's data cache, so opening or
 * refreshing a match detail page doesn't hit Supabase until the ticker actually
 * writes new data for that match.
 */
export function getMatchById(id: string): Promise<MatchWithTeams | null> {
  return unstable_cache(
    async () => {
      const supabase = createReadClient();
      if (!supabase) return null;
      const { data: match, error } = await supabase
        .from('matches')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error || !match) return null;
      const { data: teams } = await supabase.from('teams').select('*');
      return joinMatchTeams([match], teams ?? [])[0];
    },
    ['match-by-id', id],
    { tags: [`match:${id}`], revalidate: 3600 }
  )();
}

export function getLineups(matchId: string): Promise<LineupEntry[]> {
  return unstable_cache(
    async () => {
      const supabase = createReadClient();
      if (!supabase) return [];
      const { data } = await supabase
        .from('lineups')
        .select('*')
        .eq('match_id', matchId)
        .order('shirt_number');
      return data ?? [];
    },
    ['lineups', matchId],
    { tags: [`lineups:${matchId}`], revalidate: 3600 }
  )();
}

export async function getPlayersByTeam(teamId: string): Promise<Player[]> {
  const supabase = createReadClient();
  if (!supabase) return [];
  const { data } = await supabase
    .from('players')
    .select('*')
    .eq('team_id', teamId)
    .order('shirt_number');
  return data ?? [];
}

export function getReview(matchId: string): Promise<MatchReview | null> {
  return unstable_cache(
    async () => {
      const supabase = createReadClient();
      if (!supabase) return null;
      const { data } = await supabase
        .from('match_reviews')
        .select('*')
        .eq('match_id', matchId)
        .maybeSingle();
      return data ?? null;
    },
    ['review', matchId],
    { tags: [`review:${matchId}`], revalidate: 3600 }
  )();
}

export async function getReviews(matchIds: string[]): Promise<MatchReview[]> {
  const supabase = createReadClient();
  if (!supabase || matchIds.length === 0) return [];
  const { data } = await supabase
    .from('match_reviews')
    .select('*')
    .in('match_id', matchIds);
  return data ?? [];
}
