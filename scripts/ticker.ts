/**
 * PM2 entry point for the 30s live-score tick.
 *
 *   pm2 start "npm run ticker" --name wc-live-ticker
 *
 * Each tick POSTs /api/crawl/live with the shared secret. The route itself is
 * gated (no live/imminent match → instant {skipped:true}), so an always-on
 * 30s interval is cheap.
 */

export {}; // module scope — avoids global-script name collisions

const BASE_URL = process.env.APP_BASE_URL ?? 'http://localhost:3000';
const SECRET = process.env.CRON_SECRET;
const INTERVAL_MS = 30_000;

if (!SECRET) {
  console.error('CRON_SECRET is required');
  process.exit(1);
}

let ticking = false;

async function tick() {
  if (ticking) return; // never overlap slow ticks
  ticking = true;
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
  } catch (e) {
    console.error(`[${new Date().toISOString()}] tick failed:`, (e as Error).message);
  } finally {
    ticking = false;
  }
}

console.log(`wc-fever live ticker → ${BASE_URL}/api/crawl/live every ${INTERVAL_MS / 1000}s`);
tick();
setInterval(tick, INTERVAL_MS);
