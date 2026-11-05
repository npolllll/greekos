import { route, jsonBody } from '@/lib/api';
import { apiOwner } from '@/lib/auth';
import { SampleReview, recordSample } from '@/lib/qa/release';

export const POST = route(async (req) => {
  const owner = await apiOwner();
  return recordSample(owner, SampleReview.parse(await jsonBody(req)));
});
