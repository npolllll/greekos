import Link from 'next/link';
import { requireLearner } from '@/lib/page';
import { serverClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';
import { Icon } from '@/components/Icon';
import { choiceOptions, type ItemEnvelope } from '@/lib/content/types';
import { keyedOptions } from '@/lib/scoring/score';
import { countRu } from '@/lib/plural-ru';

export const metadata = { title: 'Мои ошибки' };

const KIND_RU: Record<string, string> = { accent_orthography: 'Ударение/диакритика', wrong_option: 'Неверный выбор', wrong_order: 'Порядок', wrong_assignment: 'Соответствия', rubric_error: 'По критериям задания' };
const STATUS_RU: Record<string, string> = { open: 'Открыта', practised: 'Отработана', resolved: 'Закрыта', appealed: 'Оспорена', withdrawn: 'Снята после проверки' };
const STATUS_TONE: Record<string, string> = { open: '', practised: 'blue', resolved: 'green', appealed: 'gray', withdrawn: 'gray' };

type Evidence = { prompt?: string; spans?: Array<{ kind?: string; option_key?: string; quote?: string; correction_el?: string; explanation_ru?: string }> };

/** What the learner chose and what is right, for a choice item (labels, never raw keys). */
function choiceLines(item: ItemEnvelope | undefined, keys: string[]): { chosen: string[]; correct: string[] } | null {
  if (!item) return null;
  const opts = choiceOptions(item.options);
  if (!opts.length) return null;
  const right = keyedOptions(item, opts);
  const label = (k: string) => opts.find((o) => o.key === k)?.label ?? null;
  return { chosen: keys.map(label).filter((x): x is string => !!x), correct: [...(right ?? [])].map(label).filter((x): x is string => !!x) };
}

const short = (t: string, n = 120) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

export default async function ErrorsPage() {
  const u = await requireLearner();
  void u;
  // RLS-scoped read with the learner's own session: only own rows are visible.
  const supabase = await serverClient();
  const [{ data: errors }, { data: pending }, { data: appeals }] = await Promise.all([
    supabase.from('error_evidence').select('id, item_id, competency_id, verdict, error_kind, error_tag, meaning_changing, evidence, uncertainty, correction_el, status, created_at, attempt_id').order('created_at', { ascending: false }).limit(200),
    supabase.from('assessments').select('assessment_id, attempt_id, verdict, uncertainty, created_at, feedback_ru').in('verdict', ['PENDING_REVIEW', 'ABSTAIN']).eq('status', 'ACTIVE').order('created_at', { ascending: false }).limit(50),
    supabase.from('appeals').select('id, status, reason_ru, resolution_note, created_at, resolved_at').order('created_at', { ascending: false }).limit(20),
  ]);
  const pendingAttempts = (pending ?? []).map((p) => p.attempt_id);
  const { data: attempts } = pendingAttempts.length ? await supabase.from('attempts').select('attempt_id, item_id, response_private').in('attempt_id', pendingAttempts) : { data: [] };
  const itemIds = [...new Set([...(errors ?? []).map((e) => e.item_id), ...(attempts ?? []).map((a) => a.item_id)])];
  const [{ data: comps }, { data: items }] = await Promise.all([
    adminClient().from('competencies').select('competency_id, name'),
    itemIds.length ? adminClient().from('items').select('item_id, envelope').in('item_id', itemIds) : Promise.resolve({ data: [] as Array<{ item_id: string; envelope: unknown }> }),
  ]);
  const nm = new Map((comps ?? []).map((c) => [c.competency_id, c.name]));
  const env = new Map((items ?? []).map((i) => [i.item_id, i.envelope as ItemEnvelope]));
  const attemptById = new Map((attempts ?? []).map((a) => [a.attempt_id, a]));

  // One entry per item: the same mistake repeated is one thing to work on, with a count.
  const groups = new Map<string, NonNullable<typeof errors>>();
  for (const e of errors ?? []) groups.set(e.item_id, [...(groups.get(e.item_id) ?? []), e]);
  const entries = [...groups.values()].map((g) => ({ latest: g[0], count: g.length, open: g.some((e) => e.status === 'open') }))
    .sort((a, b) => Number(b.open) - Number(a.open) || b.latest.created_at.localeCompare(a.latest.created_at));
  const openCount = entries.filter((e) => e.open).length;

  return (
    <section className="screen active">
      <div className="screen-head"><div><div className="eyebrow">GreekOS / Мои ошибки</div><h1 className="screen-title">Тетрадь ошибок</h1><p className="screen-sub">Только подтверждённые ошибки с доказательством. Неуверенное распознавание речи, помощь и технические сбои сюда не попадают.</p></div></div>
      <div className="prog-grid">
        <div className="card cardpad">
          <div className="card-top"><div className="card-title"><Icon name="rotate" /> Подтверждённые ошибки</div><span className="tag">{countRu(openCount, 'задание', 'задания', 'заданий')} к отработке</span></div>
          {entries.length ? entries.map(({ latest: e, count }) => {
            const ev = e.evidence as Evidence;
            const item = env.get(e.item_id);
            const prompt = ev.prompt ?? item?.prompt ?? '';
            const keys = (ev.spans ?? []).filter((s) => s.kind === 'choice_key' && s.option_key != null).map((s) => String(s.option_key));
            const choice = keys.length ? choiceLines(item, keys) : null;
            return (
              <details className="box mt8 err-entry" key={e.item_id}>
                <summary>
                  <span className="err-head">
                    <span className="err-prompt" lang={/\p{Script=Greek}/u.test(prompt) ? 'el' : undefined}>{short(prompt || 'Задание')}</span>
                    <span className="err-meta">{nm.get(e.competency_id ?? '') ?? 'Компетенция'} · {KIND_RU[e.error_kind ?? ''] ?? 'Ошибка'}{count > 1 ? ` · ${count}×` : ''}</span>
                  </span>
                  <span className={`tag ${STATUS_TONE[e.status] ?? ''}`}>{STATUS_RU[e.status]}</span>
                </summary>
                {prompt.length > 120 ? <p className="small" lang="el">{prompt}</p> : null}
                {choice ? (
                  <p className="small err-answer"><span>Ваш ответ: <s lang="el">{choice.chosen.join(', ') || '—'}</s></span>{choice.correct.length ? <span>Верно: <b lang="el">{choice.correct.join(', ')}</b></span> : null}</p>
                ) : null}
                {ev.spans?.filter((s) => s.quote).map((s, i) => <p key={i} className="small"><span lang="el">«{s.quote}» → <b>{s.correction_el}</b></span>{s.explanation_ru ? ` — ${s.explanation_ru}` : ''}</p>)}
                {e.correction_el ? <p className="small">Верная форма: <span className="greek-serif" lang="el">{e.correction_el}</span></p> : null}
                <p className="tiny muted">{e.meaning_changing === false ? 'Смысл не нарушен (орфография/форма).' : 'Влияет на смысл.'}{e.uncertainty ? ` Неопределённость: ${e.uncertainty}.` : ''} Последний раз: {new Date(e.created_at).toLocaleDateString('ru-RU')}</p>
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
            {(pending ?? []).length ? (pending ?? []).map((p) => {
              const a = attemptById.get(p.attempt_id);
              const item = a ? env.get(a.item_id) : undefined;
              const answer = (a?.response_private as { text?: string } | null)?.text;
              return (
                <div className="review-row" key={p.assessment_id}>
                  <div className="review-main">
                    <b>{p.verdict === 'ABSTAIN' ? 'AI воздержалась — ждёт человека' : 'Ждёт проверки'}</b>
                    {item?.prompt ? <span className="event-text">{short(item.prompt, 90)}</span> : null}
                    {answer ? <span className="event-text" lang="el">Ваш ответ: «{short(answer, 80)}»</span> : null}
                  </div>
                  <small>{new Date(p.created_at).toLocaleDateString('ru-RU')}</small>
                </div>
              );
            }) : <p className="small quiet">Нет ответов на проверке.</p>}
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
