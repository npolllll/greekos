import 'server-only';
import { createHash, randomInt } from 'node:crypto';
import { z } from 'zod';
import { adminClient } from './supabase/admin.ts';
import { audit, HttpError, type SessionUser } from './auth.ts';
import { env } from './env.ts';

/**
 * Self-registration of learners on a private platform. The owner decides the mode — closed, by
 * registration code, or open — and the number of learner seats. A request is checked on the server
 * (mode, code, free seats, rate limit) and the account is created through the e-mail link flow: the
 * visitor proves the address by opening the link, then sets a password and goes through onboarding
 * (from zero → alphabet; with experience → diagnostic → route). Direct sign-ups at the auth service
 * stay disabled, so this is the only way in besides an owner's invitation.
 */

export type RegistrationMode = 'closed' | 'code' | 'open';
export interface RegistrationSettings { registration_mode: RegistrationMode; has_code: boolean; max_learners: number; seats_used: number; seats_free: number }

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const normCode = (c: string) => c.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
const RATE_LIMIT_PER_HOUR = 5;

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
  const { data } = await adminClient().from('platform_settings').select('registration_mode, registration_code_hash, max_learners').eq('id', true).maybeSingle();
  const used = await seatsUsed();
  const max = data?.max_learners ?? 5;
  return { registration_mode: (data?.registration_mode ?? 'closed') as RegistrationMode, has_code: !!data?.registration_code_hash, max_learners: max, seats_used: used, seats_free: Math.max(0, max - used) };
}

export const RegisterRequest = z.object({
  display_name: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(200),
  code: z.string().trim().max(40).optional().default(''),
  consent: z.literal(true),
}).strict();

export type RegisterOutcome = { ok: true; message_ru: string };

async function findUserId(email: string): Promise<string | null> {
  const { data } = await adminClient().from('profiles').select('user_id').ilike('email', email).maybeSingle();
  if (data) return data.user_id;
  const db = adminClient();
  for (let page = 1; page < 20; page++) {
    const { data: list } = await db.auth.admin.listUsers({ page, perPage: 200 });
    const hit = list?.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit.id;
    if (!list || list.users.length < 200) return null;
  }
  return null;
}

/** Same answer whether or not the address already has an account (no account discovery). */
const SENT = 'Если адрес верный, мы отправили на него письмо со ссылкой. Откройте её, чтобы подтвердить e-mail и задать пароль. Ссылка одноразовая.';

export async function registerLearner(input: z.infer<typeof RegisterRequest>, ip: string): Promise<RegisterOutcome> {
  const db = adminClient();
  const email = input.email.toLowerCase();
  const ipHash = sha(`${env.registrationSalt}:${ip}`);
  const emailHash = sha(`${env.registrationSalt}:${email}`);
  const log = (outcome: string) => db.from('registration_attempts').insert({ ip_hash: ipHash, email_hash: emailHash, outcome });

  const since = new Date(Date.now() - 3_600_000).toISOString();
  const { count: recent } = await db.from('registration_attempts').select('id', { count: 'exact', head: true }).eq('ip_hash', ipHash).gte('created_at', since);
  if ((recent ?? 0) >= RATE_LIMIT_PER_HOUR) { await log('rate_limited'); throw new HttpError(429, 'RATE_LIMITED', 'Слишком много попыток. Попробуйте через час.'); }

  const { data: s } = await db.from('platform_settings').select('registration_mode, registration_code_hash, max_learners').eq('id', true).maybeSingle();
  const mode = (s?.registration_mode ?? 'closed') as RegistrationMode;
  if (mode === 'closed') { await log('closed'); throw new HttpError(403, 'REGISTRATION_CLOSED', 'Регистрация сейчас закрыта. Владелец может пригласить вас по e-mail.'); }
  if (mode === 'code' && (!s?.registration_code_hash || sha(normCode(input.code)) !== s.registration_code_hash)) { await log('bad_code'); throw new HttpError(403, 'BAD_CODE', 'Код регистрации не подходит. Уточните его у владельца курса.'); }

  if (await findUserId(email)) { await log('exists'); return { ok: true, message_ru: SENT }; }
  if ((await seatsUsed()) >= (s?.max_learners ?? 5)) { await log('no_seats'); throw new HttpError(409, 'NO_SEATS', 'Свободных мест в группе сейчас нет. Напишите владельцу курса.'); }

  const { data, error } = await db.auth.admin.inviteUserByEmail(email, { redirectTo: `${env.appUrl}/auth/set-password`, data: { display_name: input.display_name, self_registered: true } });
  if (error || !data.user) { await log('failed'); throw new HttpError(502, 'SEND_FAILED', 'Не удалось отправить письмо. Попробуйте позже.'); }
  const userId = data.user.id;
  const now = new Date().toISOString();
  await db.from('profiles').upsert({ user_id: userId, display_name: input.display_name, email, timezone: 'Europe/Athens', active: true, entry_path: 'unsure', lifecycle_state: 'invited', invited_at: now, signup_source: 'self' });
  await db.from('role_assignments').upsert({ user_id: userId, role: 'learner' });
  await db.from('preferences').upsert({ user_id: userId });
  await db.from('invitations').insert({ email, display_name: input.display_name, entry_path: 'unsure', invited_by: null, invited_user_id: userId, status: 'SENT', source: 'self' });
  // Two requests at the same moment could both see a free seat: the later one is undone.
  if ((await seatsUsed()) > (s?.max_learners ?? 5)) {
    await db.auth.admin.deleteUser(userId);
    await log('no_seats');
    throw new HttpError(409, 'NO_SEATS', 'Свободных мест в группе сейчас нет. Напишите владельцу курса.');
  }
  await log('sent');
  await audit(null, 'learner.self_registered', { id: userId, userId }, { mode });
  return { ok: true, message_ru: SENT };
}

export const RegistrationUpdate = z.object({
  registration_mode: z.enum(['closed', 'code', 'open']),
  max_learners: z.number().int().min(1).max(100),
  new_code: z.boolean().optional(),
}).strict();

/** Owner: mode, seats and (re)issued code. The code is shown once; only its hash is kept. */
export async function updateRegistration(actor: SessionUser, req: z.infer<typeof RegistrationUpdate>): Promise<RegistrationSettings & { code?: string }> {
  const db = adminClient();
  const { data: cur } = await db.from('platform_settings').select('registration_code_hash').eq('id', true).maybeSingle();
  let code: string | undefined;
  let hash = cur?.registration_code_hash ?? null;
  if (req.new_code || (req.registration_mode === 'code' && !hash)) {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    code = Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join('');
    hash = sha(normCode(code));
  }
  const used = await seatsUsed();
  if (req.max_learners < used) throw new HttpError(409, 'SEATS_BELOW_USED', `Уже занято мест: ${used}. Отключите учеников или укажите не меньше.`);
  const { error } = await db.from('platform_settings').upsert({ id: true, registration_mode: req.registration_mode, registration_code_hash: hash, max_learners: req.max_learners, updated_by: actor.userId, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
  await audit(actor.userId, 'registration.settings', {}, { mode: req.registration_mode, max_learners: req.max_learners, code_rotated: !!code });
  return { ...(await registrationSettings()), ...(code ? { code: `${code.slice(0, 4)}-${code.slice(4)}` } : {}) };
}
