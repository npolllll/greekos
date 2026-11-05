import { z } from 'zod';
import { route, jsonBody } from '@/lib/api';
import { apiUser } from '@/lib/auth';
import { startAttempt } from '@/lib/exams/service';

const Body = z.object({
  component_id: z.string().min(1).max(40),
  mode: z.enum(['simulation', 'practice']),
  idempotency_key: z.string().min(8).max(200),
}).strict();

/** POST /api/exams/start — server sets start/expiry; repeated key or open attempt is reused. */
export const POST = route(async (req) => {
  const user = await apiUser();
  return startAttempt(user, Body.parse(await jsonBody(req)));
});
