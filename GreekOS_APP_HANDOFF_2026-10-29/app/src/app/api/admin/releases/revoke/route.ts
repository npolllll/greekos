import { route, jsonBody } from '@/lib/api';
import { apiOwner } from '@/lib/auth';
import { RevokeRequest, revokeReleases } from '@/lib/admin/releases';

export const POST = route(async (req) => {
  const owner = await apiOwner();
  const revoked = await revokeReleases(owner, RevokeRequest.parse(await jsonBody(req)));
  return { ok: true, revoked };
});
