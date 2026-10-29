import { requireLearner } from '@/lib/page';
import { sessionView } from '@/lib/speaking/service';
import { adminClient } from '@/lib/supabase/admin';
import { SpeakingStage } from './SpeakingStage';

export const metadata = { title: 'Разговор' };

export default async function SpeakingSessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const u = await requireLearner();
  const { sessionId } = await params;
  const view = await sessionView(u, sessionId);
  const { data: prefs } = await adminClient().from('preferences').select('speaking_rate').eq('user_id', u.userId).maybeSingle();
  return (
    <section className="screen active">
      <SpeakingStage initial={view} defaultRate={(prefs?.speaking_rate as 'slow' | 'normal') ?? 'normal'} />
    </section>
  );
}
