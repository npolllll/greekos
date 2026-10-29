import { z } from 'zod';
import { route, jsonBody } from '@/lib/api';
import { apiUser, audit, HttpError } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { isValidTimeZone, planEndDate, localDateOf, diffDays } from '@/lib/learning/calendar';
import { emitEvent } from '@/lib/learning/state';

const Body = z.object({
  entry_path: z.enum(['from_zero', 'prior_learning', 'unsure']),
  timezone: z.string().min(3).max(64),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  daily_minutes: z.number().int().min(10).max(480),
  days_per_week: z.number().int().min(1).max(7),
  exam_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
}).strict();

export const POST = route(async (req) => {
  const u = await apiUser();
  const b = Body.parse(await jsonBody(req));
  if (!isValidTimeZone(b.timezone)) throw new HttpError(400, 'INVALID_TIMEZONE', 'Неизвестный часовой пояс');
  const today = localDateOf(new Date(), b.timezone);
  if (Math.abs(diffDays(today, b.start_date)) > 31) throw new HttpError(400, 'INVALID_START', 'Дата начала должна быть в пределах месяца от сегодняшнего дня');
  const db = adminClient();
  const { data: existing } = await db.from('enrollments').select('start_date').eq('user_id', u.userId).maybeSingle();
  if (existing?.start_date) throw new HttpError(409, 'ALREADY_ENROLLED', 'Маршрут уже начат');
  await db.from('enrollments').upsert({
    user_id: u.userId, start_date: b.start_date, timezone: b.timezone, target_months: 9, end_date: planEndDate(b.start_date),
    exam_date: b.exam_date ?? null, daily_minutes: b.daily_minutes, days_per_week: b.days_per_week, updated_at: new Date().toISOString(),
  });
  const lifecycle = b.entry_path === 'from_zero' ? 'foundations' : 'placement_pending';
  await db.from('profiles').update({ entry_path: b.entry_path, timezone: b.timezone, lifecycle_state: lifecycle, activated_at: u.profile.activated_at ?? new Date().toISOString() }).eq('user_id', u.userId);
  await db.from('learning_routes').upsert({
    user_id: u.userId, route_kind: b.entry_path === 'from_zero' ? 'foundations' : 'provisional',
    start_unit_id: b.entry_path === 'from_zero' ? 'U-A1-007' : null,
    reason: b.entry_path === 'from_zero' ? 'Самоотчёт: с полного нуля → алфавит и звуки до A1' : 'Ожидает многонавыковой диагностики; уровень не назначается по самооценке',
    set_by: u.userId,
  });
  await emitEvent(u.userId, 'route_changed', `onboarding-${u.userId}`, { route_kind: b.entry_path });
  await audit(u.userId, 'learner.onboarded', { userId: u.userId }, { entry_path: b.entry_path });
  return { ok: true, next: b.entry_path === 'from_zero' ? '/' : '/diagnostic' };
});
