import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOwnerPage, audit } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { dateTimeRu } from '@/lib/admin/labels';

export const metadata = { title: 'Транскрипт сессии' };

/** Full transcript only with the learner's active, artifact-specific consent; every view is audited. */
export default async function SessionTranscript({ params }: { params: Promise<{ id: string; sessionId: string }> }) {
  const owner = await requireOwnerPage();
  const { id, sessionId } = await params;
  const db = adminClient();
  const { data: session } = await db.from('speaking_sessions').select('session_id, user_id, scenario_id, mode, started_at').eq('session_id', sessionId).eq('user_id', id).maybeSingle();
  if (!session) notFound();
  const { data: consent } = await db.from('consents').select('consent_id, expires_at, revoked_at').eq('user_id', id).eq('purpose', 'owner_transcript_access').eq('artifact_id', sessionId).is('revoked_at', null).order('granted_at', { ascending: false }).limit(1).maybeSingle();
  const valid = !!consent && (!consent.expires_at || new Date(consent.expires_at) > new Date());
  if (!valid) {
    await audit(owner.userId, 'transcript.denied', { id: sessionId, userId: id });
    return (
      <div className="card cardpad">
        <div className="banner warn"><span><strong>Нет действующего согласия.</strong> Ученик не разрешал владельцу просмотр полного транскрипта этой сессии. Доступны только учебные сводки.</span></div>
        <Link className="btn outline" href={`/admin/learners/${id}`}>Назад к карточке</Link>
      </div>
    );
  }
  const { data: turns } = await db.from('speaking_turns').select('turn_id, seq, speaker, text_el, transcript_confirmed, interrupted').eq('session_id', sessionId).order('seq');
  await audit(owner.userId, 'transcript.viewed', { id: sessionId, userId: id }, { consent_id: consent!.consent_id, turns: turns?.length ?? 0 });
  return (
    <div className="card cardpad">
      <div className="card-top"><div className="card-title">Транскрипт {session.scenario_id} · {session.mode}</div><small>{dateTimeRu(session.started_at)}</small></div>
      <p className="tiny muted">Доступ по согласию {consent!.consent_id}{consent!.expires_at ? ` до ${dateTimeRu(consent!.expires_at)}` : ''}. Просмотр записан в журнал аудита.</p>
      <div className="transcript">
        {(turns ?? []).map((t) => (
          <div key={t.turn_id} className={`bubble greek ${t.speaker === 'learner' ? 'my' : ''}`} lang="el">
            {t.text_el ?? ''}
            <span className="meta">{t.speaker === 'learner' ? 'Ученик' : 'Персонаж'}{t.transcript_confirmed ? '' : ' · не подтверждено'}{t.interrupted ? ' · прервано' : ''}</span>
          </div>
        ))}
      </div>
      <Link className="btn outline mt16" href={`/admin/learners/${id}`}>Назад к карточке</Link>
    </div>
  );
}
