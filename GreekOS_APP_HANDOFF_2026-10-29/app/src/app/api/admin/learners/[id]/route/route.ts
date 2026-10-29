import { route, jsonBody } from '@/lib/api';
import { apiOwner } from '@/lib/auth';
import { RouteChange, changeRoute } from '@/lib/admin/learners';

type Ctx = { params: Promise<{ id: string }> };

export const POST = route<Ctx>(async (req, ctx) => {
  const owner = await apiOwner();
  const { id } = await ctx.params;
  return changeRoute(owner, id, RouteChange.parse(await jsonBody(req)));
});
