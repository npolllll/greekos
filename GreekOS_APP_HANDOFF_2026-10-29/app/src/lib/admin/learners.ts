import 'server-only';
import { z } from 'zod';
import { adminClient } from '../supabase/admin.ts';
import { audit, HttpError, type SessionUser } from '../auth.ts';
import { env } from '../env.ts';
import { emitEvent } from '../learning/state.ts';

export const InviteRequest = z.object({
  email: z.string().email().max(200),
  display_name: z.string().trim().min(1).max(80),
  entry_path: z.enum(['from_zero', 'prior_learning', 'unsure']),
  delivery: z.enum(['email', 'link']),
  confirmed: z.literal(true),
}).strict();

export function confirmLink(tokenHash: string, type: 'invite' | 'magiclink'): string {
  const q = new URLSearchParams({ token_hash: tokenHash, type, next: '/auth/set-password' });
  return `${env.appUrl}/auth/confirm?${q.toString()}`;
}

async function findUserByEmail(email: string) {
  const db = adminClient();
  for (let page = 1; page < 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

/** Invite-only account creation; nothing is sent without the owner's explicit confirmation. */
export async function inviteLearner(actor: SessionUser, req: z.infer<typeof InviteRequest>) {
  const db = adminClient();
  const email = req.email.trim().toLowerCase();
  if (await findUserByEmail(email)) throw new HttpError(409, 'EXISTS', 'Пользователь с таким e-mail уже есть. Используйте «Новая ссылка» в карточке ученика.');
  let userId: string;
  let link: string | null = null;
  if (req.delivery === 'email') {
    const { data, error } = await db.auth.admin.inviteUserByEmail(email, { redirectTo: `${env.appUrl}/auth/set-password`, data: { display_name: req.display_name } });
    if (error || !data.user) throw new HttpError(502, 'INVITE_FAILED', `Не удалось отправить приглашение: ${error?.message ?? 'нет ответа'}. Проверьте настройки SMTP или используйте ссылку.`);
    userId = data.user.id;
  } else {
    const { data, error } = await db.auth.admin.generateLink({ type: 'invite', email, options: { redirectTo: `${env.appUrl}/auth/set-password` } });
    if (error || !data.user) throw new HttpError(502, 'INVITE_FAILED', `Не удалось создать ссылку: ${error?.message ?? 'нет ответа'}`);
    userId = data.user.id;
    link = confirmLink(data.properties.hashed_token, 'invite');
  }
  const now = new Date().toISOString();
  await db.from('profiles').upsert({ user_id: userId, display_name: req.display_name, email, timezone: 'Europe/Athens', active: true, entry_path: req.entry_path, lifecycle_state: 'invited', invited_at: now });
  await db.from('role_assignments').upsert({ user_id: userId, role: 'learner', granted_by: actor.userId });
  await db.from('preferences').upsert({ user_id: userId });
  await db.from('invitations').insert({ email, display_name: req.display_name, entry_path: req.entry_path, invited_by: actor.userId, invited_user_id: userId, status: 'SENT' });
  await audit(actor.userId, 'learner.invited', { id: userId, userId }, { delivery: req.delivery, entry_path: req.entry_path });
  return { user_id: userId, link };
}

export async function freshLink(actor: SessionUser, userId: string) {
  const db = adminClient();
  const { data: p } = await db.from('profiles').select('email, active').eq('user_id', userId).maybeSingle();
  if (!p?.email) throw new HttpError(404, 'NOT_FOUND', 'Ученик не найден');
  if (!p.active) throw new HttpError(409, 'INACTIVE', 'Профиль отключён');
  const { data, error } = await db.auth.admin.generateLink({ type: 'magiclink', email: p.email, options: { redirectTo: `${env.appUrl}/auth/set-password` } });
  if (error) throw new HttpError(502, 'LINK_FAILED', error.message);
  await audit(actor.userId, 'learner.link_generated', { id: userId, userId });
  return { link: confirmLink(data.properties.hashed_token, 'magiclink') };
}

async function assertTarget(actor: SessionUser, userId: string) {
  if (userId === actor.userId) throw new HttpError(409, 'SELF', 'Нельзя выполнить это действие со своим аккаунтом владельца');
  const { data: roles } = await adminClient().from('role_assignments').select('role').eq('user_id', userId);
  if ((roles ?? []).some((r) => r.role === 'owner_admin')) throw new HttpError(409, 'OWNER_TARGET', 'Нельзя изменить аккаунт владельца из админ-панели');
  const { data: p } = await adminClient().from('profiles').select('user_id, active, lifecycle_state, activated_at').eq('user_id', userId).maybeSingle();
  if (!p) throw new HttpError(404, 'NOT_FOUND', 'Ученик не найден');
  return p;
}

/** Deactivation blocks the API (RLS + server checks), bans sign-in and revokes refresh tokens. */
export async function deactivateLearner(actor: SessionUser, userId: string, reason: string) {
  const p = await assertTarget(actor, userId);
  const db = adminClient();
  await db.from('profiles').update({ active: false, lifecycle_state: 'inactive', deactivated_at: new Date().toISOString() }).eq('user_id', userId);
  const { error } = await db.auth.admin.updateUserById(userId, { ban_duration: '876000h' });
  if (error) throw new Error(`ban failed: ${error.message}`);
  const { data: revoked } = await db.rpc('admin_revoke_user_sessions', { target: userId });
  await audit(actor.userId, 'learner.deactivated', { id: userId, userId }, { previous_state: p.lifecycle_state, reason, sessions_revoked: revoked ?? 0 });
  return { ok: true };
}

export async function reactivateLearner(actor: SessionUser, userId: string) {
  const p = await assertTarget(actor, userId);
  const db = adminClient();
  const { data: enr } = await db.from('enrollments').select('start_date').eq('user_id', userId).maybeSingle();
  const state = enr?.start_date ? 'studying' : p.activated_at ? 'activated' : 'invited';
  const { error } = await db.auth.admin.updateUserById(userId, { ban_duration: 'none' });
  if (error) throw new Error(`unban failed: ${error.message}`);
  await db.from('profiles').update({ active: true, lifecycle_state: state, deactivated_at: null }).eq('user_id', userId);
  await audit(actor.userId, 'learner.reactivated', { id: userId, userId }, { state });
  return { ok: true, state };
}

export const RouteChange = z.object({
  start_unit_id: z.string().max(40).nullable(),
  route_kind: z.enum(['foundations', 'provisional', 'verified', 'manual']),
  reason: z.string().trim().min(5).max(1000),
}).strict();

/** Manual route change by owner: requires a reason, keeps history, notifies via Realtime. */
export async function changeRoute(actor: SessionUser, userId: string, req: z.infer<typeof RouteChange>) {
  const db = adminClient();
  const { data: p } = await db.from('profiles').select('user_id').eq('user_id', userId).maybeSingle();
  if (!p) throw new HttpError(404, 'NOT_FOUND', 'Ученик не найден');
  if (req.start_unit_id) {
    const { data: u } = await db.from('units').select('unit_id').eq('unit_id', req.start_unit_id).maybeSingle();
    if (!u) throw new HttpError(400, 'UNKNOWN_UNIT', 'Нет такого урока');
  }
  const { data: prev } = await db.from('learning_routes').select('*').eq('user_id', userId).maybeSingle();
  const next = { user_id: userId, route_kind: req.route_kind, start_unit_id: req.start_unit_id, skill_profile: prev?.skill_profile ?? {}, reason: req.reason, set_by: actor.userId, set_at: new Date().toISOString() };
  const { error } = await db.from('learning_routes').upsert(next);
  if (error) throw new Error(error.message);
  await db.from('route_changes').insert({ user_id: userId, previous: prev ?? null, next, reason: req.reason, changed_by: actor.userId });
  await emitEvent(userId, 'route_changed', `route-${Date.now()}-${userId}`, { route_kind: req.route_kind, start_unit_id: req.start_unit_id, by: 'owner' });
  await audit(actor.userId, 'learner.route_changed', { id: userId, userId }, { from: prev?.start_unit_id ?? null, to: req.start_unit_id, route_kind: req.route_kind });
  return { ok: true };
}
