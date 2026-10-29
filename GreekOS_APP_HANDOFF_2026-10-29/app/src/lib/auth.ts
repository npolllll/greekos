import 'server-only';
import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import { serverClient } from './supabase/server.ts';
import { adminClient } from './supabase/admin.ts';
import { HttpError, loadSessionUser, type SessionUser } from './session-user.ts';

export { HttpError, type Profile, type SessionUser } from './session-user.ts';

/**
 * Resolve the acting user from the verified session (auth server check, not a client field).
 * Deactivated or unknown profiles are treated as signed out.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await serverClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return loadSessionUser(data.user.id, data.user.email ?? null);
}

export async function requireUser(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) redirect('/login');
  return u;
}

export async function requireOwnerPage(): Promise<SessionUser> {
  const u = await requireUser();
  if (!u.isOwner) redirect('/');
  return u;
}

export async function apiUser(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) throw new HttpError(401, 'UNAUTHENTICATED', 'Требуется вход');
  return u;
}

export async function apiOwner(): Promise<SessionUser> {
  const u = await apiUser();
  if (!u.isOwner) throw new HttpError(403, 'FORBIDDEN', 'Нужна роль владельца');
  return u;
}

/** Append-only audit record. Never pass raw transcripts, answers or secrets in meta. */
export async function audit(actorId: string | null, action: string, target: { id?: string | null; userId?: string | null } = {}, meta: Record<string, unknown> = {}) {
  await adminClient().from('admin_audit_log').insert({ actor_id: actorId, action, target_id: target.id ?? null, target_user_id: target.userId ?? null, meta });
}

/** Uniform JSON error responses for route handlers. */
export function handleRouteError(e: unknown) {
  if (e instanceof HttpError) return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
  const anyE = e as { code?: string; message?: string; name?: string };
  if (anyE?.code === 'UNSUPPORTED_CONTENT_TYPE') return NextResponse.json({ error: 'UNSUPPORTED_CONTENT_TYPE', message: 'Тип задания не поддерживается — оценка не выставляется.' }, { status: 422 });
  if (anyE?.code === 'INVALID_RESPONSE') return NextResponse.json({ error: 'INVALID_RESPONSE', message: anyE.message }, { status: 400 });
  if (anyE?.name === 'ZodError') return NextResponse.json({ error: 'INVALID_REQUEST', message: 'Некорректный запрос' }, { status: 400 });
  console.error('[route-error]', anyE?.message ?? e);
  return NextResponse.json({ error: 'INTERNAL', message: 'Внутренняя ошибка. Данные не изменены.' }, { status: 500 });
}
