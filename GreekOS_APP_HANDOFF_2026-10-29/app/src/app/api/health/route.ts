import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function GET() {
  const started = Date.now();
  const { error } = await adminClient().from('import_runs').select('id', { head: true, count: 'exact' });
  // The deployed commit (no secret): lets the deploy script refuse to roll production back.
  const commit = process.env.GREEKOS_COMMIT ?? process.env.VERCEL_GIT_COMMIT_SHA ?? null;
  return NextResponse.json({ ok: !error, db: error ? 'error' : 'ok', latency_ms: Date.now() - started, commit }, { status: error ? 503 : 200 });
}
