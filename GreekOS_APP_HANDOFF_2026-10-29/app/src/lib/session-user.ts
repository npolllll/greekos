import 'server-only';
import { adminClient } from './supabase/admin.ts';

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
}

export interface SessionUser {
  userId: string;
  email: string | null;
  profile: Profile;
  isOwner: boolean;
}

export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
  }
}

/** Profile + roles for an already-verified user id; deactivated or unknown profiles yield null. */
export async function loadSessionUser(userId: string, email: string | null = null): Promise<SessionUser | null> {
  const admin = adminClient();
  const [{ data: profile }, { data: roles }] = await Promise.all([
    admin.from('profiles').select('user_id, display_name, email, timezone, active, entry_path, lifecycle_state, invited_at, activated_at').eq('user_id', userId).maybeSingle(),
    admin.from('role_assignments').select('role').eq('user_id', userId),
  ]);
  if (!profile || !profile.active) return null;
  return { userId, email: email ?? profile.email ?? null, profile: profile as Profile, isOwner: (roles ?? []).some((r) => r.role === 'owner_admin') };
}
