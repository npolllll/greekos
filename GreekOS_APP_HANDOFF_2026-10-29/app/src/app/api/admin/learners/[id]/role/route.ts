import { z } from 'zod';
import { route, jsonBody } from '@/lib/api';
import { apiOwner } from '@/lib/auth';
import { setOwnerRole } from '@/lib/admin/learners';

type Ctx = { params: Promise<{ id: string }> };
const Body = z.object({ grant: z.boolean(), confirm_email: z.string().max(200).optional(), reason: z.string().trim().min(3).max(500) }).strict();

/** Owner grants or removes the owner role of another account (co-owner). */
export const POST = route<Ctx>(async (req, ctx) => {
  const owner = await apiOwner();
  const { id } = await ctx.params;
  return setOwnerRole(owner, id, Body.parse(await jsonBody(req)));
});
