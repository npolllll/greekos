import { z } from 'zod';
import { route, jsonBody } from '@/lib/api';
import { apiUser, HttpError } from '@/lib/auth';
import { adminClient, selectAll } from '@/lib/supabase/admin';
import { deliverItems } from '@/lib/content/delivery';
import type { ItemRow } from '@/lib/content/repo';
import { localDateOf } from '@/lib/learning/calendar';
import { FOUNDATION_UNITS } from '@/lib/learning/course';

const Body = z.object({ session_id: z.string().uuid() }).strict();

/** Completion = every currently usable in-lesson task attempted at least once (no mastery implied). */
export const POST = route(async (req) => {
  const u = await apiUser();
  const b = Body.parse(await jsonBody(req));
  const db = adminClient();
  const { data: s } = await db.from('lesson_sessions').select('id, user_id, unit_id, status').eq('id', b.session_id).maybeSingle();
  if (!s || s.user_id !== u.userId) throw new HttpError(404, 'NOT_FOUND', 'Сессия не найдена');
  if (s.status === 'COMPLETED') return { ok: true, already: true };
  const rows = await selectAll<ItemRow>((f, t) => db.from('items').select('item_id, module, unit_id, item_type, level, pool, section, requires_audio, scoring_strategy, competency_ids, prerequisite_ids, audio_job_ids, error_tags, envelope, current_hash').eq('unit_id', s.unit_id).neq('section', 'retention').order('item_id').range(f, t));
  const usable = (await deliverItems(rows, { viewer: u })).filter((d) => d.access.learnerUsable).map((d) => d.dto.item_id);
  const { data: tried } = await db.from('attempts').select('item_id').eq('user_id', u.userId).eq('preview', false).in('item_id', usable.length ? usable : ['-']);
  const triedSet = new Set((tried ?? []).map((t) => t.item_id));
  const missing = usable.filter((i) => !triedSet.has(i));
  if (missing.length) throw new HttpError(409, 'INCOMPLETE', `Остались задания без ответа: ${missing.length}.`);
  const { data } = await db.rpc('commit_learning_event', {
    p: {
      user_id: u.userId, idempotency_key: `lesson-complete-${s.id}`, scope: 'lesson',
      lesson_session: { id: s.id, status: 'COMPLETED' },
      events: [{ event_type: 'lesson_completed', idempotency_key: `lesson-complete-${s.id}`, payload: { unit_id: s.unit_id, usable_items: usable.length } }],
      activity: { local_date: localDateOf(new Date(), u.profile.timezone), attempts: 0, active_seconds: 0 },
      result: { ok: true },
    },
  });
  if (u.profile.lifecycle_state === 'foundations' && s.unit_id === FOUNDATION_UNITS[1]) await db.from('profiles').update({ lifecycle_state: 'studying' }).eq('user_id', u.userId);
  else if (['activated', 'provisional_route', 'placement_verified'].includes(u.profile.lifecycle_state)) await db.from('profiles').update({ lifecycle_state: 'studying' }).eq('user_id', u.userId);
  return { ok: true, replayed: !!data?.replayed };
});
