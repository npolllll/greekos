import { z } from 'zod';
import { route, jsonBody } from '@/lib/api';
import { apiUser, HttpError } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { releaseMap } from '@/lib/content/repo';
import { emitEvent } from '@/lib/learning/state';

const Body = z.object({ unit_id: z.string().max(40), unit_hash: z.string().regex(/^[0-9a-f]{64}$/) }).strict();

export const POST = route(async (req) => {
  const u = await apiUser();
  const b = Body.parse(await jsonBody(req));
  const db = adminClient();
  const { data: unit } = await db.from('units').select('unit_id, current_hash').eq('unit_id', b.unit_id).maybeSingle();
  if (!unit) throw new HttpError(404, 'NOT_FOUND', 'Урок не найден');
  if (unit.current_hash !== b.unit_hash) throw new HttpError(409, 'CONTENT_CHANGED', 'Урок обновился');
  if (!(await releaseMap('unit', [{ id: unit.unit_id, hash: unit.current_hash }])).has(unit.unit_id)) throw new HttpError(403, 'CONTENT_GATED', 'Урок на проверке');
  const { data: open } = await db.from('lesson_sessions').select('id').eq('user_id', u.userId).eq('unit_id', unit.unit_id).eq('status', 'IN_PROGRESS').eq('preview', false).maybeSingle();
  if (open) return { session_id: open.id };
  const { data, error } = await db.from('lesson_sessions').insert({ user_id: u.userId, unit_id: unit.unit_id, unit_hash: unit.current_hash }).select('id').single();
  if (error) throw error;
  await emitEvent(u.userId, 'lesson_started', `lesson-start-${data.id}`, { unit_id: unit.unit_id });
  return { session_id: data.id };
});
