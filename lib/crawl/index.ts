import 'server-only';
import { playwrightAdapter } from './playwright-adapter';
import { apiFootballAdapter } from './api-football-adapter';

export { cleanForLLM } from './clean';
export type { CrawlAdapter } from './types';

/**
 * Primary-with-fallback orchestration: Playwright first, API-Football only
 * when Playwright throws (browser missing, page blocked, timeout...).
 */
export async function fetchLiveData(): Promise<string> {
  try {
    return await playwrightAdapter.fetchLiveText();
  } catch (e) {
    console.warn('Playwright failed, falling back to API-Football', e);
    return await apiFootballAdapter.fetchLiveText();
  }
}

export async function fetchLineupData(query: string): Promise<string | null> {
  try {
    return await playwrightAdapter.fetchLineupText(query);
  } catch (e) {
    console.warn('Playwright lineup crawl failed', e);
    return null;
  }
}
