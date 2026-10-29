import Link from 'next/link';
import { requireLearner } from '@/lib/page';
import { serverClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';
import { Icon } from '@/components/Icon';

export const metadata = { title: 'Мои ошибки' };

const KIND_RU: Record<string, string> = { accent_orthography: 'Ударение/диакритика', wrong_option: 'Неверный выбор', wrong_order: 'Порядок', wrong_assignment: 'Соответствия', rubric_error: 'По критериям задания' };
const STATUS_RU: Record<string, string> = { open: 'Открыта', practised: 'Отработана', resolved: 'Закрыта', appealed: 'Оспорена', withdrawn: 'Снята после проверки' };

export default async function ErrorsPage() {
  const u = await requireLearner();
  // RLS-scoped read with the learner's own session: only own rows are visible.
  const supabase = await serverClient();
  const [{ data: errors }, { data: pending }, { data: appeals }] = await Promise.all([
    supabase.from('error_evidence').select('id, item_id, competency_id, verdict, error_kind, error_tag, meaning_changing, evidence, uncertainty, correction_el, status, created_at, attempt_id').order('created_at', { ascending: false }).limit(100),
    supabase.from('assessments').select('assessment_id, attempt_id, verdict, uncertainty, created_at, feedback_ru').in('verdict', ['PENDING_REVIEW', 'ABSTAIN']).eq('status', 'ACTIVE').order('created_at', { ascending: false }).limit(50),
    supabase.from('appeals').select('id, status, reason_ru, resolution_note, created_at, resolved_at').order('created_at', { ascending: false }).limit(20),
  ]);
  const { data: comps } = await adminClient().from('competencies').select('competency_id, name');
  const nm = new Map((comps ?? []).map((c) => [c.competency_id, c.name]));

  return (
    <section className="screen active">
      <div className="screen-head"><div><div className="eyebrow">GreekOS / Мои ошибки</div><h1 className="screen-title">Тетрадь ошибок</h1><p className="screen-sub">Только подтверждённые ошибки с доказательством. Неуверенное распознавание речи, помощь и технические сбои сюда не попадают.</p></div></div>
      <div className="prog-grid">
        <div className="card cardpad">
          <div className="card-top"><div className="card-title"><Icon name="rotate" /> Подтверждённые ошибки</div><span className="tag">{(errors ?? []).filter((e) => e.status === 'open').length} открыто</span></div>
          {(errors ?? []).length ? (errors ?? []).map((e) => {
            const ev = e.evidence as { prompt?: string; spans?: Array<{ quote?: string; correction_el?: string; explanation_ru?: string }> };
            return (
              <details className="box mt8" key={e.id}>
                <summary>{nm.get(e.competency_id ?? '') ?? 'Задание'} · <span className="muted">{KIND_RU[e.error_kind ?? ''] ?? 'Ошибка'} · {STATUS_RU[e.status]}</span></summary>
                {ev.prompt ? <p className="small" lang="el">{ev.prompt}</p> : null}
                {ev.spans?.filter((s) => s.quote).map((s, i) => <p key={i} className="small"><span lang="el">«{s.quote}» → <b>{s.correction_el}</b></span>{s.explanation_ru ? ` — ${s.explanation_ru}` : ''}</p>)}
                {e.correction_el ? <p className="small">Верная форма: <span className="greek-serif" lang="el">{e.correction_el}</span></p> : null}
                <p className="tiny muted">{e.meaning_changing === false ? 'Смысл не нарушен (орфография/форма).' : 'Влияет на смысл.'}{e.uncertainty ? ` Неопределённость: ${e.uncertainty}.` : ''} {new Date(e.created_at).toLocaleDateString('ru-RU')}</p>
                <div className="row mb0" style={{ paddingBottom: 12 }}>
                  <Link className="btn flat" href={`/practice/${encodeURIComponent(e.item_id)}?context=corrective`}>Потренировать заново</Link>
                </div>
              </details>
            );
          }) : <div className="empty"><strong>Пока пусто</strong>Ошибки появятся только после проверенных ответов — и это нормально.</div>}
        </div>
        <div className="stack">
          <div className="card cardpad">
            <div className="card-title"><Icon name="clock" /> На проверке (без штрафа)</div>
            {(pending ?? []).length ? (pending ?? []).map((p) => (
              <div className="review-row" key={p.assessment_id}><b>{p.verdict === 'ABSTAIN' ? 'AI воздержалась' : 'Ждёт проверки'}</b><small>{new Date(p.created_at).toLocaleDateString('ru-RU')}</small></div>
            )) : <p className="small quiet">Нет ответов на проверке.</p>}
          </div>
          <div className="card cardpad">
            <div className="card-title"><Icon name="flag" /> Оспаривания</div>
            {(appeals ?? []).length ? (appeals ?? []).map((a) => (
              <div className="review-row" key={a.id}><div><b>{a.status === 'OPEN' ? 'Рассматривается' : a.status === 'UPHELD' ? 'Принято' : 'Отклонено'}</b><span className="event-text">{a.resolution_note ?? a.reason_ru}</span></div><small>{new Date(a.created_at).toLocaleDateString('ru-RU')}</small></div>
            )) : <p className="small quiet">Оспорить оценку можно прямо в задании. Исходная оценка сохраняется, отрицательное влияние замораживается до решения.</p>}
          </div>
        </div>
      </div>
    </section>
  );
}
