import { z } from 'zod';
import { route, jsonBody } from '@/lib/api';
import { apiOwner } from '@/lib/auth';
import { deactivateLearner } from '@/lib/admin/learners';

type Ctx = { params: Promise<{ id: string }> };
const Body = z.object({ reason: z.string().trim().min(3).max(500) }).strict();

export const POST = route<Ctx>(async (req, ctx) => {
  const owner = await apiOwner();
  const { id } = await ctx.params;
  return deactivateLearner(owner, id, Body.parse(await jsonBody(req)).reason);
});
