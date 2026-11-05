import { z } from 'zod';
import { route, jsonBody } from '@/lib/api';
import { apiUser } from '@/lib/auth';
import { startDiagnostic, answerDiagnostic, skipCurrentAxis, finishDiagnostic } from '@/lib/diagnostic/service';

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start') }),
  z.object({ action: z.literal('answer'), session_id: z.string().uuid(), item_id: z.string().max(60), content_hash: z.string().regex(/^[0-9a-f]{64}$/), response: z.object({ choice: z.string().max(40).optional(), text: z.string().max(6000).optional() }).strict(), response_source: z.enum(['typed', 'asr_confirmed']), idempotency_key: z.string().min(8).max(200) }),
  z.object({ action: z.literal('skip_axis'), session_id: z.string().uuid() }),
  z.object({ action: z.literal('finish'), session_id: z.string().uuid() }),
]);

export const POST = route(async (req) => {
  const u = await apiUser();
  const b = Body.parse(await jsonBody(req));
  if (b.action === 'start') return startDiagnostic(u);
  if (b.action === 'answer') return answerDiagnostic(u, b);
  if (b.action === 'skip_axis') return skipCurrentAxis(u, b.session_id);
  return finishDiagnostic(u, b.session_id);
});
