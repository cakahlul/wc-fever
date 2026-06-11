import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized } from '@/lib/jobs/auth';
import { runReconcile } from '@/lib/jobs/reconcile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  try {
    const summary = await runReconcile();
    return NextResponse.json(summary);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
