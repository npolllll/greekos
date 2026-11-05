import { route } from '@/lib/api';
import { apiOwner } from '@/lib/auth';
import { reactivateLearner } from '@/lib/admin/learners';

type Ctx = { params: Promise<{ id: string }> };

export const POST = route<Ctx>(async (_req, ctx) => {
  const owner = await apiOwner();
  const { id } = await ctx.params;
  return reactivateLearner(owner, id);
});
