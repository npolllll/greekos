import { z } from 'zod';
import { route, jsonBody } from '@/lib/api';
import { apiOwner } from '@/lib/auth';
import { runQaBatch } from '@/lib/qa/run';

const Body = z.object({ label: z.string().max(200).optional(), unit_id: z.string().max(40).optional() }).strict();

/** Runs a full (or one-unit) digital QA batch; ~3–5 s for the whole corpus. */
export const POST = route(async (req) => {
  const owner = await apiOwner();
  const b = Body.parse(await jsonBody(req));
  return runQaBatch({ actorId: owner.userId, label: b.label ?? `Проверка владельца ${new Date().toLocaleString('ru-RU')}`, scope: b.unit_id ? { kind: 'unit', ids: [b.unit_id] } : { kind: 'all' } });
});
