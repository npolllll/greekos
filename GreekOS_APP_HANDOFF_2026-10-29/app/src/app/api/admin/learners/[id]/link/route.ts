import { route } from '@/lib/api';
import { apiOwner } from '@/lib/auth';
import { freshLink } from '@/lib/admin/learners';

type Ctx = { params: Promise<{ id: string }> };

export const POST = route<Ctx>(async (_req, ctx) => {
  const owner = await apiOwner();
  const { id } = await ctx.params;
  return freshLink(owner, id);
});
