import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, MatchWithTeams } from '@/lib/supabase/types';
import { generateProse } from '@/lib/llm';
import { HYPE_BLURB, MATCH_REVIEW } from '@/lib/llm/prompts';
import { isBigMatch } from '@/lib/domain/big-match';

/**
 * match_reviews holds ONE row per match (PK match_id), reused across the
 * match lifecycle: a hype blurb before kickoff (big matches only), replaced
 * by the full review once the match finishes. Generated once, cached forever
 * — jobs always check for an existing row of the right vintage first.
 */

export async function generateMatchReview(
  db: SupabaseClient<Database>,
  match: MatchWithTeams
): Promise<boolean> {
  if (match.status !== 'finished' || !match.home_team || !match.away_team) return false;

  const events = (match.events ?? [])
    .map((e) => `${e.minute}' ${e.type} ${e.team === 'home' ? match.home_team!.name : match.away_team!.name}${e.player ? ` (${e.player})` : ''}`)
    .join('; ');
  const context = [
    `${match.home_team.name} ${match.home_score} - ${match.away_score} ${match.away_team.name}`,
    `Stage: ${match.stage}${match.group ? ` (Group ${match.group})` : ''}`,
    match.venue ? `Venue: ${match.venue}, ${match.city}` : '',
    events ? `Events: ${events}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const body = await generateProse(MATCH_REVIEW, context);
  if (!body) return false;

  const { error } = await db
    .from('match_reviews')
    .upsert({ match_id: match.id, body, language: 'en', generated_at: new Date().toISOString() });
  return !error;
}

export async function generateHypeBlurb(
  db: SupabaseClient<Database>,
  match: MatchWithTeams
): Promise<boolean> {
  const verdict = isBigMatch(match, match.home_team, match.away_team);
  if (!verdict.isBig || !match.home_team || !match.away_team) return false;

  const context = [
    `${match.home_team.name} vs ${match.away_team.name}`,
    `Stage: ${match.stage}${match.group ? ` (Group ${match.group})` : ''}`,
    match.venue ? `Venue: ${match.venue}, ${match.city}` : '',
    `Why it's big: ${verdict.reasons.join('; ')}`,
    `FIFA ranks: ${match.home_team.fifa_rank} vs ${match.away_team.fifa_rank}`,
  ]
    .filter(Boolean)
    .join('\n');

  const body = await generateProse(HYPE_BLURB, context);
  if (!body) return false;

  const { error } = await db
    .from('match_reviews')
    .upsert({ match_id: match.id, body, language: 'en', generated_at: new Date().toISOString() });
  return !error;
}
