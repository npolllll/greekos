import { requireLearner } from '@/lib/page';
import { currentView } from '@/lib/diagnostic/service';
import { asrStatus } from '@/lib/providers/speech';
import { DiagnosticRunner } from './DiagnosticRunner';
import { adminClient } from '@/lib/supabase/admin';

export const metadata = { title: 'Определение уровня' };

export default async function DiagnosticPage() {
  const u = await requireLearner();
  const [view, { data: enr }] = await Promise.all([currentView(u), adminClient().from('enrollments').select('self_level').eq('user_id', u.userId).maybeSingle()]);
  return (
    <section className="screen active">
      <DiagnosticRunner initial={view} entryPath={u.profile.entry_path} selfLevel={enr?.self_level ?? null} voice={asrStatus().configured && !asrStatus().synthetic} />
    </section>
  );
}
