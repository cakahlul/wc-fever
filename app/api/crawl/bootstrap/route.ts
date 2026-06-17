import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized } from '@/lib/jobs/auth';
import { runBootstrap } from '@/lib/jobs/bootstrap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // crawls every group + up to 48 squads

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  try {
    const force = req.nextUrl.searchParams.get('force');
    const forceEspn = force === '1' || force === 'true';
    const summary = await runBootstrap({ forceEspn });
    return NextResponse.json(summary);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
