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

export interface CleanOptions {
  cap?: number;
  minLineLength?: number;
}

export function cleanForLLM(raw: string, opts: CleanOptions = {}): string {
  const cap = opts.cap ?? LLM_INPUT_CHAR_CAP;
  const minLineLength = opts.minLineLength ?? 15;
  const lines = raw.split('\n').map((l) => l.trim());

  const kept: string[] = [];
  for (const line of lines) {
    if (line.length === 0) {
      kept.push('');
      continue;
    }
    if (line.length < minLineLength) continue;
    if (NOISE_PATTERNS.some((p) => p.test(line))) continue;
    kept.push(line);
  }

  let text = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  if (text.length > cap) {
    text = text.slice(0, cap) + '\n[truncated]';
  }
  return text;
}
