import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Minimal .env loader for the standalone scripts. Next.js only loads
 * .env.local for the app itself — scripts run via tsx don't get it. Real
 * environment variables (e.g. set by PM2/cron on the VPS) always win;
 * file values only fill in the blanks.
 */
export function loadEnvLocal() {
  for (const file of ['.env.local', '.env']) {
    let text: string;
    try {
      text = readFileSync(resolve(process.cwd(), file), 'utf8');
    } catch {
      continue; // file absent — fine
    }
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const [, key, rawValue] = m;
      if (process.env[key] !== undefined) continue;
      // strip surrounding quotes and trailing inline comments on bare values
      let value = rawValue;
      if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
      else value = value.replace(/\s+#.*$/, '');
      process.env[key] = value;
    }
  }
}
