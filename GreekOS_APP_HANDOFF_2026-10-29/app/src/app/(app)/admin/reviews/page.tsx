import { requireOwnerPage, audit } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { choiceOptions, type ItemEnvelope } from '@/lib/content/types';
import { VERDICT_LABEL, dateTimeRu } from '@/lib/admin/labels';
import { ReviewDecisionForm, AppealDecisionForm } from '../_components/ReviewForms';

export const metadata = { title: 'Проверка ответов' };

type Resp = { choice?: string; text?: string; source?: string } | null;

function responseView(env: ItemEnvelope | undefined, r: Resp): { choice: string | null; text: string | null; hidden: boolean } {
  if (!r) return { choice: null, text: null, hidden: false };
  const choice = r.choice != null && env ? choiceOptions(env.options).find((o) => o.key === r.choice)?.label ?? r.choice : null;
  if (r.source === 'asr_confirmed') return { choice, text: null, hidden: true };
  return { choice, text: r.text ?? null, hidden: false };
}

export default async function ReviewsPage() {
  const owner = await requireOwnerPage();
  const db = adminClient();
  const [{ data: pending }, { data: appeals }] = await Promise.all([
    db.from('assessments').select('assessment_id, attempt_id, user_id, verdict, scorer, feedback_ru, dimensions, uncertainty, created_at').in('verdict', ['PENDING_REVIEW', 'ABSTAIN']).eq('status', 'ACTIVE').order('created_at').limit(100),
    db.from('appeals').select('id, user_id, assessment_id, reason_ru, status, created_at').eq('status', 'OPEN').order('created_at').limit(100),
  ]);
  const appealAssessments = (appeals ?? []).length ? (await db.from('assessments').select('assessment_id, attempt_id, verdict, feedback_ru, scorer').in('assessment_id', (appeals ?? []).map((a) => a.assessment_id))).data ?? [] : [];
  const attemptIds = [...new Set([...(pending ?? []).map((p) => p.attempt_id), ...appealAssessments.map((a) => a.attempt_id)])];
  const { data: attempts } = attemptIds.length ? await db.from('attempts').select('attempt_id, item_id, context, assistance, preview, response_private, created_at').in('attempt_id', attemptIds) : { data: [] };
  const itemIds = [...new Set((attempts ?? []).map((a) => a.item_id))];
  const { data: items } = itemIds.length ? await db.from('items').select('item_id, envelope').in('item_id', itemIds) : { data: [] };
  const userIds = [...new Set([...(pending ?? []).map((p) => p.user_id), ...(appeals ?? []).map((a) => a.user_id)])];
  const { data: profiles } = userIds.length ? await db.from('profiles').select('user_id, display_name').in('user_id', userIds) : { data: [] };
  const attemptOf = (id: string) => (attempts ?? []).find((a) => a.attempt_id === id);
  const envOf = (id?: string) => (items ?? []).find((i) => i.item_id === id)?.envelope as ItemEnvelope | undefined;
  const nameOf = (id: string) => (profiles ?? []).find((p) => p.user_id === id)?.display_name ?? '—';
  if ((pending ?? []).length || (appeals ?? []).length) await audit(owner.userId, 'review.viewed', {}, { pending: pending?.length ?? 0, appeals: appeals?.length ?? 0 });

  return (
    <div className="admin-section">
      <div className="banner info"><span>Решение здесь записывается как <b>«Проверено владельцем — не независимый преподаватель»</b>. Исходная автоматическая оценка сохраняется; новая запись её заменяет, а не переписывает.</span></div>
      <div className="card cardpad">
        <div className="card-title">Оспаривания ({appeals?.length ?? 0})</div>
        {(appeals ?? []).length ? (appeals ?? []).map((ap) => {
          const as = appealAssessments.find((a) => a.assessment_id === ap.assessment_id);
          const at = as ? attemptOf(as.attempt_id) : undefined;
          const env = envOf(at?.item_id);
          const rv = responseView(env, (at?.response_private ?? null) as Resp);
          return (
            <div key={ap.id} className="locked-item" style={{ display: 'block' }}>
              <div className="row between"><b>{nameOf(ap.user_id)} · {at?.item_id}</b><small>{dateTimeRu(ap.created_at)}</small></div>
              <p className="small">{env?.prompt}</p>
              {rv.choice ? <p className="small">Выбор: <b lang="el">{rv.choice}</b></p> : null}
              {rv.text ? <div className="stimulus" lang="el">{rv.text}</div> : rv.hidden ? <p className="tiny muted">Ответ — распознанная речь; текст скрыт без согласия.</p> : null}
              <p className="small">Исходная оценка: <b>{VERDICT_LABEL[as?.verdict ?? ''] ?? as?.verdict}</b> ({as?.scorer}). Причина ученика: «{ap.reason_ru}»</p>
              <AppealDecisionForm appealId={ap.id} />
            </div>
          );
        }) : <p className="small quiet">Открытых оспариваний нет.</p>}
      </div>
      <div className="card cardpad">
        <div className="card-title">Ответы, ожидающие проверки ({pending?.length ?? 0})</div>
        {(pending ?? []).length ? (pending ?? []).map((p) => {
          const at = attemptOf(p.attempt_id);
          const env = envOf(at?.item_id);
          const rv = responseView(env, (at?.response_private ?? null) as Resp);
          const dims = (p.dimensions ?? []) as Array<{ label_ru: string; level: string; note_ru: string }>;
          return (
            <div key={p.assessment_id} className="locked-item" style={{ display: 'block' }}>
              <div className="row between"><b>{nameOf(p.user_id)} · {at?.item_id} · {env?.type}</b><small>{VERDICT_LABEL[p.verdict]} · {dateTimeRu(p.created_at)}</small></div>
              <p className="small" lang="el">{env?.prompt}</p>
              {(env?.criteria ?? []).length ? <ul className="criteria">{env!.criteria.map((c) => <li key={c}>{c}</li>)}</ul> : null}
              {rv.choice ? <p className="small">Выбор: <b lang="el">{rv.choice}</b></p> : null}
              {rv.text ? <div className="stimulus" lang="el">{rv.text}</div> : rv.hidden ? <p className="tiny muted">Ответ — распознанная речь; текст скрыт без согласия.</p> : null}
              {(env?.answer ?? []).length ? <p className="tiny muted">Ключ (не исчерпывающий): <span lang="el">{(env!.answer as string[]).join(' / ')}</span></p> : null}
              {dims.length ? <ul className="criteria">{dims.map((d, i) => <li key={i}><span className="ai-label">AI</span> {d.label_ru}: {d.level}. {d.note_ru}</li>)}</ul> : null}
              <p className="tiny muted">Контекст: {at?.context} · помощь: {at?.assistance}{p.uncertainty ? ` · ${p.uncertainty}` : ''}</p>
              <ReviewDecisionForm assessmentId={p.assessment_id} />
            </div>
          );
        }) : <p className="small quiet">Очередь пуста.</p>}
      </div>
    </div>
  );
}
