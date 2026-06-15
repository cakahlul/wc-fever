import 'server-only';
import OpenAI from 'openai';

/**
 * LLM access — OpenAI-compatible endpoint (self-hosted VPS). Endpoint, key
 * and model all come from env; never hardcode a provider URL.
 */

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (client) return client;
  if (!process.env.LLM_BASE_URL || !process.env.LLM_API_KEY) {
    throw new Error('LLM_BASE_URL / LLM_API_KEY not configured');
  }
  client = new OpenAI({
    baseURL: process.env.LLM_BASE_URL,
    apiKey: process.env.LLM_API_KEY,
  });
  return client;
}

/**
 * Structured extraction — always JSON mode. Returns null on any failure so
 * callers can treat "LLM unavailable" the same as "nothing extracted".
 */
export async function extractJSON<T>(
  systemPrompt: string,
  userContent: string
): Promise<T | null> {
  try {
    const res = await getClient().chat.completions.create({
      model: process.env.LLM_MODEL!,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      max_tokens: 4000,
    });
    const text = res.choices[0].message.content ?? '';
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean) as T;
  } catch (e) {
    console.error('[llm] extractJSON failed:', (e as Error).message);
    return null;
  }
}

/** Prose generation — no JSON mode (reviews, hype blurbs). '' on failure. */
export async function generateProse(
  systemPrompt: string,
  userContent: string
): Promise<string> {
  try {
    const res = await getClient().chat.completions.create({
      model: process.env.LLM_MODEL!,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      max_tokens: 300,
    });
    return res.choices[0].message.content?.trim() ?? '';
  } catch {
    return '';
  }
}
