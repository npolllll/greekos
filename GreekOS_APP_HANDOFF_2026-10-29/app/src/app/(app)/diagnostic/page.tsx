import { requireLearner } from '@/lib/page';
import { currentView } from '@/lib/diagnostic/service';
import { asrStatus } from '@/lib/providers/speech';
import { DiagnosticRunner } from './DiagnosticRunner';

export const metadata = { title: 'Определение уровня' };

export default async function DiagnosticPage() {
  const u = await requireLearner();
  const view = await currentView(u);
  return (
    <section className="screen active">
      <DiagnosticRunner initial={view} entryPath={u.profile.entry_path} voice={asrStatus().configured && !asrStatus().synthetic} />
    </section>
  );
}
