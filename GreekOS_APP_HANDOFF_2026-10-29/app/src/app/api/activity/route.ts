import { z } from 'zod';
import { route, jsonBody } from '@/lib/api';
import { apiUser } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { localDateOf } from '@/lib/learning/calendar';

/** Active-time heartbeat: client sends only visible, interacted seconds; capped per beat. */
const Body = z.object({ seconds: z.number().int().min(1).max(120), beat_id: z.string().min(8).max(80) }).strict();

export const POST = route(async (req) => {
  const u = await apiUser();
  const b = Body.parse(await jsonBody(req));
  const { data } = await adminClient().rpc('commit_learning_event', {
    p: { user_id: u.userId, idempotency_key: `beat-${b.beat_id}`, scope: 'activity', activity: { local_date: localDateOf(new Date(), u.profile.timezone), active_seconds: b.seconds, attempts: 0 }, result: { ok: true } },
  });
  return { ok: true, replayed: !!data?.replayed };
});
