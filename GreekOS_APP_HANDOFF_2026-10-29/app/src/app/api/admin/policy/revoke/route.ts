import { z } from 'zod';
import { route, jsonBody } from '@/lib/api';
import { apiOwner, audit, HttpError } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';

const Body = z.object({ policy_id: z.string().uuid(), reason: z.string().trim().min(3).max(500) }).strict();

/** Revoking the policy revokes every release that relied on it. */
export const POST = route(async (req) => {
  const owner = await apiOwner();
  const b = Body.parse(await jsonBody(req));
  const db = adminClient();
  const now = new Date().toISOString();
  const { data: p } = await db.from('publication_policies').select('id, revoked_at').eq('id', b.policy_id).maybeSingle();
  if (!p || p.revoked_at) throw new HttpError(404, 'NOT_FOUND', 'Действующая политика не найдена');
  await db.from('publication_policies').update({ revoked_at: now, revoked_by: owner.userId }).eq('id', b.policy_id);
  const { data: rel } = await db.from('content_releases').update({ revoked_at: now, revoked_reason: 'POLICY_REVOKED' }).eq('policy_id', b.policy_id).is('revoked_at', null).select('id');
  await audit(owner.userId, 'policy.revoked', { id: b.policy_id }, { reason: b.reason, releases_revoked: rel?.length ?? 0 });
  return { ok: true, releases_revoked: rel?.length ?? 0 };
});
