import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { adminClient } from './supabase/admin.ts';
import { audit, HttpError, type SessionUser } from './auth.ts';
import { env } from './env.ts';

/**
 * GreekOS is a private platform: only the owner gives access (Админ → Ученики → «Добавить ученика»:
 * the account is created and a one-time link is shown to the owner, no e-mail needed). Self-registration
 * was removed on 13.11.2026; the database allows only the «closed» mode, so no setting can reopen it.
 * The public endpoint stays only to answer old links with a clear refusal.
 */

export type RegistrationMode = 'closed';
export interface RegistrationSettings { registration_mode: RegistrationMode; has_code: boolean; max_learners: number; seats_used: number; seats_free: number }

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** Active learner accounts that take a seat (the owner and local test accounts do not). */
export async function seatsUsed(): Promise<number> {
  const db = adminClient();
  const { data: learners } = await db.from('role_assignments').select('user_id').eq('role', 'learner');
  const { data: owners } = await db.from('role_assignments').select('user_id').eq('role', 'owner_admin');
  const ownerIds = new Set((owners ?? []).map((o) => o.user_id));
  const ids = [...new Set((learners ?? []).map((l) => l.user_id))].filter((id) => !ownerIds.has(id));
  if (!ids.length) return 0;
  const { count } = await db.from('profiles').select('user_id', { count: 'exact', head: true }).in('user_id', ids).eq('active', true).eq('account_kind', 'learner');
  return count ?? 0;
}

export async function registrationSettings(): Promise<RegistrationSettings> {
  const { data } = await adminClient().from('platform_settings').select('max_learners').eq('id', true).maybeSingle();
  const used = await seatsUsed();
  const max = data?.max_learners ?? 5;
  return { registration_mode: 'closed', has_code: false, max_learners: max, seats_used: used, seats_free: Math.max(0, max - used) };
}

export const RegisterRequest = z.object({
  display_name: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(200),
  code: z.string().trim().max(40).optional().default(''),
  consent: z.literal(true),
}).strict();

export type RegisterOutcome = { ok: true; message_ru: string };

export async function registerLearner(input: z.infer<typeof RegisterRequest>, ip: string): Promise<RegisterOutcome> {
  const db = adminClient();
  const ipHash = sha(`${env.registrationSalt}:${ip}`);
  const emailHash = sha(`${env.registrationSalt}:${input.email.toLowerCase()}`);
  await db.from('registration_attempts').insert({ ip_hash: ipHash, email_hash: emailHash, outcome: 'closed' });
  throw new HttpError(403, 'REGISTRATION_CLOSED', 'Регистрация закрыта: доступ выдаёт владелец курса.');
}

export const RegistrationUpdate = z.object({
  max_learners: z.number().int().min(1).max(100),
}).strict();

/** Owner: the number of learner seats (a guard against inviting more accounts than planned). */
export async function updateRegistration(actor: SessionUser, req: z.infer<typeof RegistrationUpdate>): Promise<RegistrationSettings> {
  const db = adminClient();
  const used = await seatsUsed();
  if (req.max_learners < used) throw new HttpError(409, 'SEATS_BELOW_USED', `Уже занято мест: ${used}. Отключите учеников или укажите не меньше.`);
  const { error } = await db.from('platform_settings').upsert({ id: true, registration_mode: 'closed', registration_code_hash: null, max_learners: req.max_learners, updated_by: actor.userId, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
  await audit(actor.userId, 'registration.settings', {}, { mode: 'closed', max_learners: req.max_learners });
  return registrationSettings();
}
