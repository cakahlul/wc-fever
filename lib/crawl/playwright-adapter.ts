import 'server-only';
import { chromium, type Browser } from 'playwright';
import { cleanForLLM } from './clean';
import type { CrawlAdapter } from './types';

/**
 * PRIMARY crawl source: headless Chromium against Google's live-score panel.
 * Playwright is required — these pages are JS-rendered, so a plain fetch()
 * returns empty HTML.
 *
 * The browser is a process-wide singleton, reused across ticks (launching
 * Chromium per tick would dominate the 30s cadence) and closed on exit.
 */

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (browser && browser.isConnected()) return browser;
  browser = await chromium.launch({ headless: true });
  return browser;
}

let exitHookInstalled = false;
function installExitHook() {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on('exit', () => {
    browser?.close().catch(() => {});
  });
  process.on('SIGTERM', () => {
    browser?.close().catch(() => {});
  });
}

async function crawlPage(url: string, waitSelector?: string): Promise<string> {
  installExitHook();
  const b = await getBrowser();
  const page = await b.newPage();
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 20_000 });
    if (waitSelector) {
      await page.waitForSelector(waitSelector, { timeout: 8_000 }).catch(() => {});
    }
    const raw = await page.evaluate(() => document.body.innerText);
    return cleanForLLM(raw);
  } finally {
    await page.close();
  }
}

export async function crawlLiveScores(): Promise<string> {
  return crawlPage(
    'https://www.google.com/search?q=FIFA+World+Cup+2026+live+score',
    '[data-ved]'
  );
}

export async function crawlLineups(query: string): Promise<string | null> {
  const text = await crawlPage(
    `https://www.google.com/search?q=${encodeURIComponent(`${query} lineup starting XI World Cup 2026`)}`,
    '[data-ved]'
  );
  return text.length > 100 ? text : null;
}

/** Generic crawl for one-off queries (schedule backfill, squad lists). */
export async function crawlSearch(query: string): Promise<string> {
  return crawlPage(`https://www.google.com/search?q=${encodeURIComponent(query)}`, '[data-ved]');
}

export const playwrightAdapter: CrawlAdapter = {
  name: 'playwright',
  fetchLiveText: crawlLiveScores,
  fetchLineupText: crawlLineups,
};
