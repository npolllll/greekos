import 'server-only';
import { adminClient } from './supabase/admin.ts';
import { env } from './env.ts';

/** DEV-PREVIEW can only exist in local development or automated tests — never preview/production. */
export function devPreviewAllowedEnv(): boolean {
  return env.appEnv === 'local' || env.appEnv === 'test';
}

/**
 * Framework-free identity primitives. Shared by Next.js route handlers (via auth.ts) and the
 * standalone voice gateway process, which must not load Next's request-scoped modules.
 */
export interface Profile {
  user_id: string;
  display_name: string;
  email: string | null;
  timezone: string;
  active: boolean;
  entry_path: 'from_zero' | 'prior_learning' | 'unsure' | null;
  lifecycle_state: string;
  invited_at: string | null;
  activated_at: string | null;
  account_kind?: 'learner' | 'dev_preview_tester';
}

export interface SessionUser {
  userId: string;
  email: string | null;
  profile: Profile;
  isOwner: boolean;
  /** Owner-granted DEV-PREVIEW of gated content (local/test environments only, test accounts or owner). */
  devPreview: boolean;
}

export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
  }
}

/** Profile + roles for an already-verified user id; deactivated or unknown profiles yield null. */
export async function loadSessionUser(userId: string, email: string | null = null): Promise<SessionUser | null> {
  const admin = adminClient();
  const [{ data: profile }, { data: roles }, { data: grant }] = await Promise.all([
    admin.from('profiles').select('user_id, display_name, email, timezone, active, entry_path, lifecycle_state, invited_at, activated_at, account_kind').eq('user_id', userId).maybeSingle(),
    admin.from('role_assignments').select('role').eq('user_id', userId),
    admin.from('dev_preview_access').select('expires_at, revoked_at').eq('user_id', userId).maybeSingle(),
  ]);
  if (!profile || !profile.active) return null;
  const isOwner = (roles ?? []).some((r) => r.role === 'owner_admin');
  const devPreview = devPreviewAllowedEnv() && !!grant && !grant.revoked_at && new Date(grant.expires_at) > new Date()
    && (isOwner || profile.account_kind === 'dev_preview_tester');
  return { userId, email: email ?? profile.email ?? null, profile: profile as Profile, isOwner, devPreview };
}
