import 'server-only';
import { chromium as chromiumExtra } from 'playwright-extra';
// puppeteer-extra-plugin-stealth bundles ~17 evasions for the standard
// fingerprint tells (webdriver, plugins, chrome obj, WebGL vendor, etc.)
// and works fine with playwright-extra.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
import type { BrowserContext } from 'playwright';
import { cleanForLLM, type CleanOptions } from './clean';
import type { CrawlAdapter } from './types';

chromiumExtra.use(StealthPlugin());

/**
 * PRIMARY crawl source: headless Chromium against Google's live-score panel.
 * Playwright is required — these pages are JS-rendered, so a plain fetch()
 * returns empty HTML.
 *
 * Stealth tuning is critical here: Google aggressively blocks default headless
 * Chromium with their "unusual traffic" interstitial. We launch a single long-
 * lived browserContext with:
 *   - a real Chrome User-Agent (not HeadlessChrome)
 *   - the AutomationControlled feature disabled
 *   - an init script that masks navigator.webdriver and a few other tells
 *   - the Google consent cookie pre-set so EU-style consent walls don't fire
 *   - persistent storage (cookies survive across calls within the process)
 * If Google still blocks specific queries, we surface that via short crawl
 * output rather than failing the whole job.
 */

let context: BrowserContext | null = null;

const REAL_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function getContext(): Promise<BrowserContext> {
  if (context) return context;
  const browser = await chromiumExtra.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--no-sandbox',
    ],
  });
  context = await browser.newContext({
    userAgent: REAL_UA,
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
    deviceScaleFactor: 1,
    hasTouch: false,
    isMobile: false,
    javaScriptEnabled: true,
  });
  // Mask the most common bot tells before any script on the page runs.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    // @ts-expect-error chrome global is read by Google's detection
    window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {} };
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5].map(() => ({})),
    });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
    const originalQuery = window.navigator.permissions.query.bind(window.navigator.permissions);
    window.navigator.permissions.query = (params: PermissionDescriptor) =>
      params.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
        : originalQuery(params);
  });
  // Pre-accept Google's consent so EU-region IPs don't get walled.
  await context.addCookies([
    {
      name: 'CONSENT',
      value: 'YES+cb',
      domain: '.google.com',
      path: '/',
      expires: Math.floor(Date.now() / 1000) + 365 * 24 * 3600,
      sameSite: 'Lax',
    },
    {
      name: 'SOCS',
      value: 'CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg',
      domain: '.google.com',
      path: '/',
      expires: Math.floor(Date.now() / 1000) + 365 * 24 * 3600,
      sameSite: 'Lax',
    },
  ]);
  return context;
}

let exitHookInstalled = false;
function installExitHook() {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  const close = () => {
    context?.browser()?.close().catch(() => {});
  };
  process.on('exit', close);
  process.on('SIGTERM', close);
}

async function crawlPage(
  url: string,
  waitSelector?: string,
  cleanOpts?: CleanOptions
): Promise<string> {
  installExitHook();
  const ctx = await getContext();
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 });
    if (waitSelector) {
      await page.waitForSelector(waitSelector, { timeout: 8_000 }).catch(() => {});
    }
    // Give late-arriving panels (Google live-score widget) a moment.
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
    const raw = await page.evaluate(() => document.body.innerText);
    return cleanForLLM(raw, cleanOpts);
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

/**
 * Crawl match timeline (goals/cards/subs) from Google's match panel timeline view.
 * Returns null if the panel doesn't render a usable timeline.
 */
export async function crawlTimeline(query: string): Promise<string | null> {
  const text = await crawlPage(
    `https://www.google.com/search?q=${encodeURIComponent(`${query} timeline goals World Cup 2026`)}`,
    '[data-ved]'
  );
  return text.length > 100 ? text : null;
}

/** Generic crawl for one-off queries (schedule backfill, squad lists). */
export async function crawlSearch(query: string): Promise<string> {
  return crawlPage(`https://www.google.com/search?q=${encodeURIComponent(query)}`, '[data-ved]');
}

/**
 * Wikipedia crawl — uses Special:Search?go=Go which redirects directly to the
 * canonical article when an exact match exists, otherwise lands on a results
 * page. Wikipedia does not block headless browsers, so this is a reliable
 * source for fixtures and squads.
 */
export async function crawlWikipedia(query: string): Promise<string> {
  return crawlPage(
    `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(query)}&go=Go`,
    '#mw-content-text',
    { cap: 20_000, minLineLength: 0 }
  );
}

/** Wikipedia crawl with a much larger cap, for index pages that we slice ourselves. */
export async function crawlWikipediaLong(query: string): Promise<string> {
  return crawlPage(
    `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(query)}&go=Go`,
    '#mw-content-text',
    { cap: 400_000, minLineLength: 0 }
  );
}

export const playwrightAdapter: CrawlAdapter = {
  name: 'playwright',
  fetchLiveText: crawlLiveScores,
  fetchLineupText: crawlLineups,
};
