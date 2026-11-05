import { z } from 'zod';
import { route, jsonBody } from '@/lib/api';
import { apiUser } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';

const Body = z.object({ reduced_motion: z.boolean().optional(), speaking_rate: z.enum(['slow', 'normal']).optional() }).strict();

export const POST = route(async (req) => {
  const u = await apiUser();
  const b = Body.parse(await jsonBody(req));
  await adminClient().from('preferences').upsert({ user_id: u.userId, ...b, updated_at: new Date().toISOString() });
  return { ok: true };
});
