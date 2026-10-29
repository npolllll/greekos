import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

/** Daily retention job (Vercel Cron): deletes voice recordings past their consent window. */
export async function GET(req: Request) {
  const secret = env.cronSecret;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const db = adminClient();
  const now = new Date().toISOString();
  const { data: expired } = await db.from('voice_artifacts').select('id, object_path').is('deleted_at', null).lt('retention_until', now).limit(500);
  const { data: revoked } = await db.from('voice_artifacts').select('id, object_path, consents!inner(revoked_at)').is('deleted_at', null).not('consents.revoked_at', 'is', null).limit(500);
  const all = [...(expired ?? []), ...((revoked ?? []) as Array<{ id: string; object_path: string }>)];
  if (all.length) {
    await db.storage.from('voice-review').remove(all.map((a) => a.object_path));
    await db.from('voice_artifacts').update({ deleted_at: now }).in('id', all.map((a) => a.id));
  }
  await db.from('admin_audit_log').insert({ actor_id: null, action: 'cron.retention', meta: { deleted: all.length } });
  return NextResponse.json({ ok: true, deleted: all.length });
}
