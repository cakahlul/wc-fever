/**
 * One-shot bootstrap trigger: `npm run crawl:bootstrap`
 * Fills schedule gaps, seeds squads, generates missing reviews. Idempotent.
 */

export {}; // module scope — avoids global-script name collisions

const BASE_URL = process.env.APP_BASE_URL ?? 'http://localhost:3000';
const SECRET = process.env.CRON_SECRET;

if (!SECRET) {
  console.error('CRON_SECRET is required');
  process.exit(1);
}

async function main() {
  console.log(`POST ${BASE_URL}/api/crawl/bootstrap ...`);
  const res = await fetch(`${BASE_URL}/api/crawl/bootstrap`, {
    method: 'POST',
    headers: { 'x-cron-secret': SECRET! },
  });
  const body = await res.json().catch(() => ({}));
  console.log(`HTTP ${res.status}`);
  console.log(JSON.stringify(body, null, 2));
  if (!res.ok) process.exit(1);
}

main();
