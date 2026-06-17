/**
 * PM2 entry point for the live-score tick.
 *
 *   pm2 start "npm run ticker" --name wc-live-ticker
 *
 * Each tick POSTs /api/crawl/live with the shared secret. The route itself is
 * gated (no live/imminent match → instant {skipped:true}), so polling is cheap.
 * The interval self-paces off the tick's `liveCount`: fast (10s) while a match
 * is in play, slow (60s) otherwise.
 */

import { loadEnvLocal } from './load-env';
loadEnvLocal();

const BASE_URL = process.env.APP_BASE_URL ?? 'http://localhost:3000';
const SECRET = process.env.CRON_SECRET;
const LIVE_INTERVAL_MS = 5_000;
const IDLE_INTERVAL_MS = 60_000;

if (!SECRET) {
  console.error('CRON_SECRET is required');
  process.exit(1);
}

async function tick(): Promise<number> {
  const startedAt = Date.now();
  try {
    const res = await fetch(`${BASE_URL}/api/crawl/live`, {
      method: 'POST',
      headers: { 'x-cron-secret': SECRET! },
    });
    const body = await res.json().catch(() => ({}));
    console.log(
      `[${new Date().toISOString()}] tick ${res.status} ${Date.now() - startedAt}ms`,
      JSON.stringify(body)
    );
    return (body?.liveCount ?? 0) > 0 ? LIVE_INTERVAL_MS : IDLE_INTERVAL_MS;
  } catch (e) {
    console.error(`[${new Date().toISOString()}] tick failed:`, (e as Error).message);
    return IDLE_INTERVAL_MS;
  }
}

// Self-scheduling loop — sequential by construction, so ticks never overlap and
// the next delay reflects the live/idle state the tick just observed.
async function loop() {
  const nextDelay = await tick();
  setTimeout(loop, nextDelay);
}

console.log(`wc-fever live ticker → ${BASE_URL}/api/crawl/live (5s live / 60s idle)`);
loop();
