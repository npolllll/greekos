import { z } from 'zod';
import { route, jsonBody } from '@/lib/api';
import { apiOwner, audit, HttpError } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { deleteLearnerAccount } from '@/lib/privacy';

type Ctx = { params: Promise<{ id: string }> };
const Body = z.object({ confirm: z.literal('УДАЛИТЬ') }).strict();

/** Permanent deletion of a learner account and all learner rows (FK cascade) + stored voice. */
export const POST = route<Ctx>(async (req, ctx) => {
  const owner = await apiOwner();
  const { id } = await ctx.params;
  Body.parse(await jsonBody(req));
  if (id === owner.userId) throw new HttpError(409, 'SELF', 'Нельзя удалить собственный аккаунт владельца');
  const { data: roles } = await adminClient().from('role_assignments').select('role').eq('user_id', id);
  if ((roles ?? []).some((r) => r.role === 'owner_admin')) throw new HttpError(409, 'OWNER_TARGET', 'Нельзя удалить аккаунт владельца');
  await audit(owner.userId, 'learner.deleted_by_owner', { id, userId: id });
  await deleteLearnerAccount(id);
  return { ok: true };
});
