import { route } from '@/lib/api';
import { apiOwner } from '@/lib/auth';
import { checkProviders } from '@/lib/admin/qa';

export const maxDuration = 120;

export const POST = route(async () => {
  const owner = await apiOwner();
  return checkProviders(owner);
});
