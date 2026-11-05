import { z } from 'zod';
import { route, jsonBody } from '@/lib/api';
import { apiUser } from '@/lib/auth';
import { submit } from '@/lib/exams/service';

export const maxDuration = 300;

const Body = z.object({
  attempt_id: z.string().uuid(),
  seq: z.number().int().min(0).max(1_000_000).optional(),
  answers: z.record(z.string(), z.unknown()).optional(),
}).strict();

/** POST /api/exams/submit — idempotent; returns stored provisional results on repeat. */
export const POST = route(async (req) => {
  const user = await apiUser();
  return submit(user, Body.parse(await jsonBody(req, 200_000)));
});
