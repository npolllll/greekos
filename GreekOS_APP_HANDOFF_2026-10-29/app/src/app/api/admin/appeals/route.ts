import { route, jsonBody } from '@/lib/api';
import { apiOwner } from '@/lib/auth';
import { AppealDecision, decideAppeal } from '@/lib/admin/review';

export const POST = route(async (req) => {
  const owner = await apiOwner();
  return decideAppeal(owner, AppealDecision.parse(await jsonBody(req)));
});
