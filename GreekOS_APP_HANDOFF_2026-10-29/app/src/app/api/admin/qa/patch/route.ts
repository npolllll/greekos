import { z } from 'zod';
import { route, jsonBody } from '@/lib/api';
import { apiOwner } from '@/lib/auth';
import { ItemPatch, UnitPatch, patchItem, patchUnit } from '@/lib/qa/release';

const Body = z.union([ItemPatch, UnitPatch]);

export const POST = route(async (req) => {
  const owner = await apiOwner();
  const b = Body.parse(await jsonBody(req));
  return 'item_id' in b ? patchItem(owner, b) : patchUnit(owner, b);
});
