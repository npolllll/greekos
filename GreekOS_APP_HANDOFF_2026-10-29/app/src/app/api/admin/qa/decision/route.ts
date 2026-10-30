import { z } from 'zod';
import { route, jsonBody } from '@/lib/api';
import { apiOwner } from '@/lib/auth';
import { Decision, decideRelease, revokeDecision } from '@/lib/qa/release';

const Revoke = z.object({ revoke: z.string().uuid(), reason: z.string().min(3).max(500) }).strict();

export const POST = route(async (req) => {
  const owner = await apiOwner();
  const raw = await jsonBody(req);
  const r = Revoke.safeParse(raw);
  if (r.success) return revokeDecision(owner, r.data.revoke, r.data.reason);
  return decideRelease(owner, Decision.parse(raw));
});
