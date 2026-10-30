import { route, jsonBody } from '@/lib/api';
import { apiOwner } from '@/lib/auth';
import { DevPreviewRequest, createTester, grantDevPreview, revokeDevPreview, devPreviewOverview } from '@/lib/admin/dev-preview';

export const GET = route(async () => {
  await apiOwner();
  return devPreviewOverview();
});

export const POST = route(async (req) => {
  const owner = await apiOwner();
  const b = DevPreviewRequest.parse(await jsonBody(req));
  if (b.action === 'create_tester') return createTester(owner, b);
  if (b.action === 'grant') return grantDevPreview(owner, b.user_id, b.days, b.note);
  return revokeDevPreview(owner, b.user_id, b.reason);
});
