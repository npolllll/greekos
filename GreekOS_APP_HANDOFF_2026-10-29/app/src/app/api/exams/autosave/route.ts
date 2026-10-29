import { z } from 'zod';
import { route, jsonBody } from '@/lib/api';
import { apiUser } from '@/lib/auth';
import { autosave } from '@/lib/exams/service';

const Body = z.object({
  attempt_id: z.string().uuid(),
  seq: z.number().int().min(1).max(1_000_000),
  answers: z.record(z.string(), z.unknown()),
}).strict();

/** POST /api/exams/autosave — full answer snapshot with strictly increasing seq. */
export const POST = route(async (req) => {
  const user = await apiUser();
  return autosave(user, Body.parse(await jsonBody(req, 200_000)));
});
