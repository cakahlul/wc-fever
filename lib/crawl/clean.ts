/**
 * Mandatory pre-processing for ALL crawled text before it reaches the LLM.
 * Protects the LLM context window and prevents runaway token cost.
 */

const NOISE_PATTERNS: RegExp[] = [
  /cookie|consent|privacy policy|terms of service|terms of use/i,
  /^advert|sponsored|^ad\b|adchoices/i,
  /sign in|log in|create account|subscribe now/i,
  /all rights reserved|©|copyright/i,
  /accessibility|feedback|help center/i,
  /^settings$|^search$|^images$|^news$|^videos$|^maps$|^shopping$/i,
];

export const LLM_INPUT_CHAR_CAP = 3000;

export function cleanForLLM(raw: string): string {
  const lines = raw.split('\n').map((l) => l.trim());

  const kept: string[] = [];
  for (const line of lines) {
    if (line.length === 0) {
      kept.push('');
      continue;
    }
    // 1. Strip short lines — nav links, icon labels, stray numbers.
    if (line.length < 15) continue;
    // 2. Strip ad / cookie / legal boilerplate.
    if (NOISE_PATTERNS.some((p) => p.test(line))) continue;
    kept.push(line);
  }

  // 3. Collapse 3+ consecutive blank lines into one.
  let text = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  // 4. Hard cap — never feed the model more than this.
  if (text.length > LLM_INPUT_CHAR_CAP) {
    text = text.slice(0, LLM_INPUT_CHAR_CAP) + '\n[truncated]';
  }
  return text;
}
