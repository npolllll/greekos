import { requireUser } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { AppShell } from '@/components/AppShell';
import { LiveProvider } from '@/components/LiveProvider';
import { LIFECYCLE_RU } from '@/lib/page';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const u = await requireUser();
  const db = adminClient();
  const [{ data: prefs }, learners] = await Promise.all([
    db.from('preferences').select('reduced_motion').eq('user_id', u.userId).maybeSingle(),
    u.isOwner ? db.from('role_assignments').select('user_id', { count: 'exact', head: true }).eq('role', 'learner') : Promise.resolve({ count: null }),
  ]);
  const envLabel = env.appEnv === 'production' ? null : env.appEnv === 'preview' ? 'тестовая среда (preview)' : 'локальная среда разработки';
  return (
    <LiveProvider userId={u.userId} isOwner={u.isOwner}>
      <AppShell
        name={u.profile.display_name}
        meta={u.isOwner ? 'Владелец' : LIFECYCLE_RU[u.profile.lifecycle_state] ?? ''}
        isOwner={u.isOwner}
        learnerCount={learners.count ?? null}
        envLabel={envLabel}
        reducedMotion={!!prefs?.reduced_motion}
        devPreview={u.devPreview}
        tester={u.profile.account_kind === 'dev_preview_tester'}
      >
        {children}
      </AppShell>
    </LiveProvider>
  );
}
