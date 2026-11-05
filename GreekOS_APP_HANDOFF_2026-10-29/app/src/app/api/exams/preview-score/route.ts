import { z } from 'zod';
import { route, jsonBody } from '@/lib/api';
import { apiOwner } from '@/lib/auth';
import { previewScore } from '@/lib/exams/service';

const Body = z.object({ component_id: z.string().min(1).max(40), answers: z.record(z.string(), z.unknown()) }).strict();

/** Owner editorial QA: deterministic scoring only, nothing persisted, no AI spend. */
export const POST = route(async (req) => {
  await apiOwner();
  const b = Body.parse(await jsonBody(req, 200_000));
  return previewScore(b.component_id, b.answers);
});
