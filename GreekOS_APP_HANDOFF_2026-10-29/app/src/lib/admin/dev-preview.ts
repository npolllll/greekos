import 'server-only';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { adminClient } from '../supabase/admin.ts';
import { audit } from '../audit.ts';
import { devPreviewAllowedEnv, HttpError, type SessionUser } from '../session-user.ts';

/**
 * Owner-controlled DEV-PREVIEW: lets the owner (or an explicitly marked test learner) walk the real,
 * still-gated corpus end to end in a local/test environment. It never creates releases, never applies
 * to ordinary learner accounts (DB trigger) and is refused outside local/test (server check).
 */
export const DevPreviewRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create_tester'), display_name: z.string().min(1).max(80), email: z.string().email().max(200), days: z.number().int().min(1).max(30).default(14) }).strict(),
  z.object({ action: z.literal('grant'), user_id: z.string().uuid(), days: z.number().int().min(1).max(30).default(14), note: z.string().max(300).optional() }).strict(),
  z.object({ action: z.literal('revoke'), user_id: z.string().uuid(), reason: z.string().min(3).max(300) }).strict(),
]);

function assertEnv() {
  if (!devPreviewAllowedEnv()) throw new HttpError(403, 'DEV_PREVIEW_DISABLED', 'DEV-PREVIEW доступен только в локальной среде (APP_ENV=local) и в тестах.');
}

export async function grantDevPreview(actor: SessionUser, userId: string, days: number, note?: string) {
  assertEnv();
  const db = adminClient();
  const now = new Date();
  const { error } = await db.from('dev_preview_access').upsert({
    user_id: userId, granted_by: actor.userId, granted_at: now.toISOString(), expires_at: new Date(now.getTime() + days * 86_400_000).toISOString(),
    scope: 'all_gated_content', revoked_at: null, revoked_by: null, note: note ?? null,
  });
  if (error) throw new HttpError(409, 'NOT_ELIGIBLE', error.message.includes('limited') ? 'DEV-PREVIEW выдаётся только владельцу и тестовым аккаунтам.' : error.message);
  await audit(actor.userId, 'dev_preview.grant', { userId }, { days });
  return { ok: true, expires_at: new Date(now.getTime() + days * 86_400_000).toISOString() };
}

export async function revokeDevPreview(actor: SessionUser, userId: string, reason: string) {
  const db = adminClient();
  await db.from('dev_preview_access').update({ revoked_at: new Date().toISOString(), revoked_by: actor.userId, note: reason }).eq('user_id', userId).is('revoked_at', null);
  await audit(actor.userId, 'dev_preview.revoke', { userId }, { reason });
  return { ok: true };
}

/** Creates a clearly marked test learner with a one-time password, then grants DEV-PREVIEW. */
export async function createTester(actor: SessionUser, input: { display_name: string; email: string; days: number }) {
  assertEnv();
  const db = adminClient();
  const password = `Gx-${randomBytes(9).toString('base64url')}`;
  const { data, error } = await db.auth.admin.createUser({ email: input.email, password, email_confirm: true, user_metadata: { test_account: true } });
  if (error || !data.user) throw new HttpError(409, 'CREATE_FAILED', error?.message ?? 'Не удалось создать тестовый аккаунт');
  const id = data.user.id;
  await db.from('profiles').insert({ user_id: id, display_name: input.display_name, email: input.email, timezone: actor.profile.timezone, active: true, lifecycle_state: 'activated', invited_at: new Date().toISOString(), activated_at: new Date().toISOString(), account_kind: 'dev_preview_tester' });
  await db.from('role_assignments').insert({ user_id: id, role: 'learner', granted_by: actor.userId });
  await db.from('preferences').insert({ user_id: id });
  await audit(actor.userId, 'dev_preview.create_tester', { userId: id }, { email_domain: input.email.split('@')[1] ?? null });
  const grant = await grantDevPreview(actor, id, input.days, 'тестовый аккаунт DEV-PREVIEW');
  return { user_id: id, email: input.email, password_once: password, expires_at: grant.expires_at };
}

export async function devPreviewOverview() {
  const db = adminClient();
  const [{ data: grants }, { data: testers }] = await Promise.all([
    db.from('dev_preview_access').select('user_id, granted_at, expires_at, revoked_at, note').order('granted_at', { ascending: false }),
    db.from('profiles').select('user_id, display_name, email, account_kind, lifecycle_state, active').eq('account_kind', 'dev_preview_tester'),
  ]);
  return { env_allowed: devPreviewAllowedEnv(), grants: grants ?? [], testers: testers ?? [] };
}
