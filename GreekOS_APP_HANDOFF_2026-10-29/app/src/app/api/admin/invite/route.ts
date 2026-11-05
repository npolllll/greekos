import { route, jsonBody } from '@/lib/api';
import { apiOwner } from '@/lib/auth';
import { InviteRequest, inviteLearner } from '@/lib/admin/learners';

export const POST = route(async (req) => {
  const owner = await apiOwner();
  return inviteLearner(owner, InviteRequest.parse(await jsonBody(req)));
});
