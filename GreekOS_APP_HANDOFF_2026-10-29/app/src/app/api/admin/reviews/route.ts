import { route, jsonBody } from '@/lib/api';
import { apiOwner } from '@/lib/auth';
import { ReviewDecision, decideReview } from '@/lib/admin/review';

export const POST = route(async (req) => {
  const owner = await apiOwner();
  return decideReview(owner, ReviewDecision.parse(await jsonBody(req)));
});
