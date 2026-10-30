import { adminClient } from './supabase/admin.ts';

/** Append-only audit record. Never pass raw transcripts, answers or secrets in meta. */
export async function audit(actorId: string | null, action: string, target: { id?: string | null; userId?: string | null } = {}, meta: Record<string, unknown> = {}) {
  await adminClient().from('admin_audit_log').insert({ actor_id: actorId, action, target_id: target.id ?? null, target_user_id: target.userId ?? null, meta });
}
