import { z } from 'zod';
import { route, jsonBody } from '@/lib/api';
import { apiUser } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';

const Body = z.object({
  daily_minutes: z.number().int().min(10).max(480),
  days_per_week: z.number().int().min(1).max(7),
  exam_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
}).strict();

/** Editable schedule; start date (and thus the 9-month end) is not changed by the exam date. */
export const POST = route(async (req) => {
  const u = await apiUser();
  const b = Body.parse(await jsonBody(req));
  await adminClient().from('enrollments').update({ ...b, updated_at: new Date().toISOString() }).eq('user_id', u.userId);
  return { ok: true };
});
