import { route } from '@/lib/api';
import { apiUser, audit } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { emitEvent } from '@/lib/learning/state';

export const POST = route(async () => {
  const u = await apiUser();
  if (u.profile.lifecycle_state === 'invited') {
    await adminClient().from('profiles').update({ lifecycle_state: 'activated', activated_at: new Date().toISOString() }).eq('user_id', u.userId).eq('lifecycle_state', 'invited');
    await adminClient().from('invitations').update({ status: 'ACCEPTED', accepted_at: new Date().toISOString() }).eq('invited_user_id', u.userId).eq('status', 'SENT');
    await emitEvent(u.userId, 'profile_activated', `activate-${u.userId}`);
    await audit(u.userId, 'profile.activated', { userId: u.userId });
  }
  return { ok: true };
});
