import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized } from '@/lib/jobs/auth';
import { runLiveTick } from '@/lib/jobs/live';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  try {
    const summary = await runLiveTick();
    return NextResponse.json(summary);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
