import { z } from 'zod';
import { route, jsonBody } from '@/lib/api';
import { apiUser, audit, HttpError } from '@/lib/auth';
import { deleteLearnerAccount } from '@/lib/privacy';

const Body = z.object({ confirm: z.literal('УДАЛИТЬ') }).strict();

export const POST = route(async (req) => {
  const u = await apiUser();
  Body.parse(await jsonBody(req));
  if (u.isOwner) throw new HttpError(409, 'OWNER_ACCOUNT', 'Аккаунт владельца удаляется только через процедуру передачи владения.');
  await audit(u.userId, 'learner.self_delete', { userId: u.userId });
  await deleteLearnerAccount(u.userId);
  return { ok: true };
});
