import 'server-only';
import { redirect } from 'next/navigation';
import { adminClient } from './supabase/admin.ts';
import { requireUser, type SessionUser } from './auth.ts';

/** Learner pages require a started enrollment; new accounts go through /welcome first. */
export async function requireLearner(): Promise<SessionUser & { onboarded: boolean }> {
  const u = await requireUser();
  const { data } = await adminClient().from('enrollments').select('start_date').eq('user_id', u.userId).maybeSingle();
  const onboarded = !!data?.start_date;
  if (!onboarded && !u.isOwner) redirect('/welcome');
  return { ...u, onboarded };
}

export function greeting(timezone: string): string {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: timezone }).format(new Date()));
  if (h < 5) return 'Доброй ночи';
  if (h < 12) return 'Доброе утро';
  if (h < 18) return 'Добрый день';
  return 'Добрый вечер';
}

export const LEVEL_RU: Record<string, string> = { A1: 'A1', A2: 'A2', B1: 'B1', B2: 'B2' };
export const ENTRY_RU: Record<string, string> = { from_zero: 'С полного нуля', prior_learning: 'Уже изучал(а)', unsure: 'Не уверен(а)' };
export const LIFECYCLE_RU: Record<string, string> = {
  invited: 'Приглашён', activated: 'Активирован', foundations: 'Основы чтения', placement_pending: 'Ждёт диагностики',
  placement_in_progress: 'Диагностика', provisional_route: 'Предварительный маршрут', placement_verified: 'Маршрут подтверждён',
  studying: 'Учится', inactive: 'Неактивен',
};
