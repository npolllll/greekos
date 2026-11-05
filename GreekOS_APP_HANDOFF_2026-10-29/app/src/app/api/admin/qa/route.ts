import { z } from 'zod';
import { route, jsonBody } from '@/lib/api';
import { apiOwner } from '@/lib/auth';
import { runLinguisticQa } from '@/lib/admin/qa';

export const maxDuration = 120;
const Body = z.object({ item_id: z.string().min(1).max(80) }).strict();

export const POST = route(async (req) => {
  const owner = await apiOwner();
  return runLinguisticQa(owner, Body.parse(await jsonBody(req)).item_id);
});
