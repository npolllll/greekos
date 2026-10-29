import { z } from 'zod';
import { route, jsonBody } from '@/lib/api';
import { apiUser, HttpError } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { refreshCompetencyState } from '@/lib/learning/state';

const Body = z.object({ attempt_id: z.string().uuid(), reason_ru: z.string().min(3).max(2000) }).strict();

/** Appeal: keeps the original judgement, freezes negative effect until resolved. */
export const POST = route(async (req) => {
  const u = await apiUser();
  const b = Body.parse(await jsonBody(req));
  const db = adminClient();
  const { data: a } = await db.from('assessments').select('assessment_id, attempt_id, user_id, status').eq('attempt_id', b.attempt_id).eq('user_id', u.userId).eq('status', 'ACTIVE').order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!a) throw new HttpError(404, 'NOT_FOUND', 'Оценка не найдена');
  const { error } = await db.from('appeals').insert({ user_id: u.userId, assessment_id: a.assessment_id, reason_ru: b.reason_ru });
  if (error) throw new HttpError(409, 'ALREADY_APPEALED', 'Эта оценка уже оспорена');
  await db.from('assessments').update({ status: 'UNDER_APPEAL' }).eq('assessment_id', a.assessment_id);
  await db.from('error_evidence').update({ status: 'appealed' }).eq('assessment_id', a.assessment_id).eq('user_id', u.userId);
  const { data: comps } = await db.from('mastery_events').select('competency_id').eq('attempt_id', b.attempt_id);
  await refreshCompetencyState(u.userId, [...new Set((comps ?? []).map((c) => c.competency_id))], u.profile.timezone);
  await db.from('learner_events').insert({ user_id: u.userId, event_type: 'appeal_opened', idempotency_key: `appeal-${a.assessment_id}`, payload: { attempt_id: b.attempt_id } });
  return { ok: true };
});
