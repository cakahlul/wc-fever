import 'server-only';
import type { NextRequest } from 'next/server';

/** Shared-secret guard for all /api/crawl/* routes. */
export function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  return !!secret && req.headers.get('x-cron-secret') === secret;
}
