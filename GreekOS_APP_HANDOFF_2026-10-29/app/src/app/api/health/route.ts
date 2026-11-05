import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function GET() {
  const started = Date.now();
  const { error } = await adminClient().from('import_runs').select('id', { head: true, count: 'exact' });
  return NextResponse.json({ ok: !error, db: error ? 'error' : 'ok', latency_ms: Date.now() - started }, { status: error ? 503 : 200 });
}
