import { route, jsonBody } from '@/lib/api';
import { apiOwner } from '@/lib/auth';
import { ReleaseRequest, createReleases } from '@/lib/admin/releases';

export const POST = route(async (req) => {
  const owner = await apiOwner();
  return createReleases(owner, ReleaseRequest.parse(await jsonBody(req)));
});
