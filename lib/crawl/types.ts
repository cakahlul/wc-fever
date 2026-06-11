/**
 * Swappable crawl source interface. The Playwright adapter is primary; the
 * API-Football adapter is the structured fallback. Both return plain text
 * ready for `extractJSON` (the fallback pre-formats its JSON as text so the
 * downstream LLM extraction path is identical).
 */
export interface CrawlAdapter {
  name: string;
  /** Raw-ish text describing current live scores (already cleaned/capped). */
  fetchLiveText(): Promise<string>;
  /** Text describing lineups for a fixture, or null if unavailable. */
  fetchLineupText(query: string): Promise<string | null>;
}
