import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, MatchWithTeams } from '@/lib/supabase/types';
import { generateProse } from '@/lib/llm';
import { HYPE_BLURB, MATCH_REVIEW } from '@/lib/llm/prompts';
import { isBigMatch } from '@/lib/domain/big-match';
import type { EspnRecap } from '@/lib/crawl/espn-adapter';

/**
 * match_reviews holds ONE row per match (PK match_id), reused across the
 * match lifecycle: a hype blurb before kickoff (big matches only), replaced
 * by the full review once the match finishes. `source` distinguishes the
 * authoritative ESPN recap ('espn') from the LLM fallback ('generated') so
 * the recap is never overwritten and jobs stop re-crawling once it's stored.
 */

/**
 * Store ESPN's post-match recap as the match review. Body is the headline
 * followed by the story paragraphs (blank-line separated); the UI splits it
 * back out. Authoritative for finished matches — overwrites any LLM fallback.
 */
export async function storeEspnRecap(
  db: SupabaseClient<Database>,
  matchId: string,
  recap: EspnRecap
): Promise<boolean> {
  const body = recap.headline ? `${recap.headline}\n\n${recap.body}` : recap.body;
  if (!body.trim()) return false;
  const { error } = await db.from('match_reviews').upsert({
    match_id: matchId,
    body,
    language: 'en',
    source: 'espn',
    generated_at: new Date().toISOString(),
  });
  return !error;
}

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
    .upsert({ match_id: match.id, body, language: 'en', source: 'generated', generated_at: new Date().toISOString() });
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
    .upsert({ match_id: match.id, body, language: 'en', source: 'generated', generated_at: new Date().toISOString() });
  return !error;
}
