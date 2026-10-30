'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import type { ItemDTO } from '@/lib/content/dto';
import { ItemPlayer } from '@/components/ItemPlayer';
import { Icon } from '@/components/Icon';
import { SayButton } from '@/components/SayButton';

export interface LessonStep {
  key: string;
  title: string;
  items: ItemDTO[];
  locked: Array<{ item_id: string; reason: string }>;
}

const STEP_HINT: Record<string, string> = {
  theory: 'Правило и цель урока',
  examples: 'Фразы и слова с озвучкой',
  practice: 'Упражнения с проверкой',
  reception: 'Чтение и аудирование',
  production: 'Своё письмо и речь',
  transfer: 'Новая ситуация',
};

/** Only whole Greek phrases are voiced; notation lines (αι → [e], [af]/[av]) are shown, not read aloud. */
function speakable(text: string): boolean {
  return /\p{Script=Greek}/u.test(text) && !/[[\]→/:|=]/u.test(text);
}

export function LessonClient(props: {
  unitId: string;
  unitHash: string;
  preview: boolean;
  devPreview: boolean;
  sessionId: string | null;
  completed: boolean;
  answeredBefore: string[];
  theory: string;
  objectives: string[];
  outcome: string;
  examples: string[];
  vocabulary: Array<{ lemma: string; inflection: string; meaning: string; example: string }>;
  steps: LessonStep[];
  retentionCount: number;
  qa: { status: string; human: string; audio: string };
  nextUnit: { unit_id: string; title_ru: string } | null;
}) {
  const router = useRouter();
  const tabs = useMemo(() => [
    { key: 'theory', title: 'Теория' },
    { key: 'examples', title: 'Фразы и слова' },
    ...props.steps.filter((s) => s.items.length || s.locked.length).map((s) => ({ key: s.key, title: s.title })),
  ], [props.steps]);
  const [tab, setTab] = useState('theory');
  const [dir, setDir] = useState(1);
  const [answered, setAnswered] = useState<Set<string>>(() => new Set(props.answeredBefore));
  const [sessionId, setSessionId] = useState(props.sessionId);
  const [done, setDone] = useState(props.completed);
  const [msg, setMsg] = useState<string | null>(null);
  const started = useRef(false);
  const panel = useRef<HTMLDivElement>(null);
  const total = props.steps.reduce((a, s) => a + s.items.length, 0);
  const answeredCount = props.steps.reduce((a, s) => a + s.items.filter((i) => answered.has(i.item_id)).length, 0);
  const pct = total ? Math.round((answeredCount / total) * 100) : 0;

  useEffect(() => {
    if (props.preview || started.current || sessionId) return;
    started.current = true;
    fetch('/api/lessons/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ unit_id: props.unitId, unit_hash: props.unitHash }) })
      .then((r) => r.json()).then((j) => j.session_id && setSessionId(j.session_id)).catch(() => undefined);
  }, [props.preview, props.unitId, props.unitHash, sessionId]);

  const stepsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Keep the active stage visible in the scrollable stage bar.
    stepsRef.current?.querySelector<HTMLElement>('.step.active')?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
  }, [tab]);

  function go(key: string) {
    const from = tabs.findIndex((t) => t.key === tab);
    const to = tabs.findIndex((t) => t.key === key);
    setDir(to >= from ? 1 : -1);
    setTab(key);
    // Keep the task in view without a jarring jump.
    panel.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function complete() {
    setMsg(null);
    const res = await fetch('/api/lessons/complete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session_id: sessionId }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return setMsg(j.message ?? 'Не удалось завершить урок.');
    setDone(true);
    router.refresh();
  }

  const idx = tabs.findIndex((t) => t.key === tab);
  const step = props.steps.find((s) => s.key === tab);
  const stepDone = (key: string) => {
    const st = props.steps.find((s) => s.key === key);
    return st ? st.items.length > 0 && st.items.every((i) => answered.has(i.item_id)) : tabs.findIndex((t) => t.key === key) < idx;
  };

  return (
    <div className="lesson-layout">
      <div ref={panel} style={{ scrollMarginTop: 90 }}>
        <LayoutGroup id="lesson-steps">
          <div className="steps" role="tablist" aria-label="Этапы урока" ref={stepsRef}>
            {tabs.map((t, i) => (
              <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`step ${tab === t.key ? 'active' : ''} ${tab !== t.key && stepDone(t.key) ? 'done' : ''}`} onClick={() => go(t.key)}>
                {tab === t.key ? <motion.span layoutId="step-pill" className="step-pill" transition={{ type: 'spring', stiffness: 480, damping: 38 }} /> : null}
                <span className="n">{tab !== t.key && stepDone(t.key) ? <Icon name="check" size={12} /> : i + 1}</span>{t.title}
              </button>
            ))}
          </div>
        </LayoutGroup>

        <AnimatePresence mode="wait" initial={false} custom={dir}>
          <motion.div
            key={tab}
            custom={dir}
            variants={{ enter: (d: number) => ({ opacity: 0, x: 24 * d, filter: 'blur(4px)' }), center: { opacity: 1, x: 0, filter: 'blur(0px)' }, exit: (d: number) => ({ opacity: 0, x: -16 * d, filter: 'blur(3px)' }) }}
            initial="enter" animate="center" exit="exit"
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            role="tabpanel"
          >
            {tab === 'theory' ? (
              <div className="card cardpad focus-surface">
                {props.outcome ? <p className="small" style={{ marginTop: 0, fontWeight: 650, color: 'var(--ink)' }}><Icon name="target" size={15} /> {props.outcome}</p> : null}
                {props.objectives.length ? <ul className="criteria" style={{ marginBottom: 16 }}>{props.objectives.map((o) => <li key={o}>{o}</li>)}</ul> : null}
                <div className="theory">{props.theory || 'Объяснение для этого урока не заполнено.'}</div>
              </div>
            ) : null}

            {tab === 'examples' ? (
              <div className="stack">
                <div className="card cardpad focus-surface">
                  <div className="card-top"><div className="card-title"><Icon name="chat" /> Полезные фразы</div><span className="tag gray">из урока</span></div>
                  {props.examples.length ? (
                    <table className="phrase-table">
                      <thead><tr><th style={{ width: 44 }}><span className="sr-only">Озвучка</span></th><th>Греческий</th></tr></thead>
                      <tbody>
                        {props.examples.map((e) => (
                          <tr key={e}><td>{speakable(e) ? <SayButton unitId={props.unitId} text={e} /> : <span className="sound disabled" title="Нотация звуков: озвучиваются только целые фразы" aria-hidden="true"><Icon name="info" size={14} /></span>}</td><td><span className="gr" lang="el">{e}</span></td></tr>
                        ))}
                      </tbody>
                    </table>
                  ) : <p className="small quiet">В этом уроке нет отдельного списка примеров.</p>}
                  <p className="disclosure" style={{ marginBottom: 0 }}>Озвучка — синтезированный голос el-GR, создаётся по запросу и проверяется распознаванием перед показом. Это не запись носителя.</p>
                </div>
                {props.vocabulary.length ? (
                  <div className="card cardpad focus-surface">
                    <div className="card-top"><div className="card-title"><Icon name="layers" /> Слова урока</div><span className="tag gray">{props.vocabulary.length}</span></div>
                    <div className="vocab">{props.vocabulary.map((v) => (
                      <div key={v.lemma}>
                        <div className="row between" style={{ flexWrap: 'nowrap' }}><b lang="el">{v.lemma}</b><SayButton unitId={props.unitId} text={v.lemma} small /></div>
                        <small>{v.meaning}</small>
                        {v.inflection ? <small lang="el">{v.inflection}</small> : null}
                        {v.example ? <small lang="el" style={{ color: 'var(--ink-2)' }}>{v.example}</small> : null}
                      </div>
                    ))}</div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {step ? (
              <div className="stack">
                {step.items.length === 0 && step.locked.length === 0 ? <div className="card empty"><strong>В этом этапе нет заданий</strong></div> : null}
                {step.items.map((it, n) => (
                  <div key={it.item_id}>
                    <p className="tiny quiet" style={{ margin: '0 0 6px 4px' }}>Упражнение {n + 1} из {step.items.length}{answered.has(it.item_id) ? ' · ответ сохранён' : ''}</p>
                    <ItemPlayer item={it} context="lesson" contextRef={sessionId ?? undefined} preview={props.preview} onResult={() => setAnswered((s) => new Set(s).add(it.item_id))} />
                  </div>
                ))}
                {step.locked.length ? (
                  <div className="card cardpad">
                    <div className="card-title"><Icon name="lock" /> Закрытые задания этого этапа</div>
                    {step.locked.map((l) => (
                      <div className="locked-item" key={l.item_id}><span className={`lock-dot ${l.reason === 'AUDIO_PENDING' ? 'audio' : ''}`} />{l.item_id}<span className="muted" style={{ marginLeft: 'auto' }}>{l.reason === 'AUDIO_PENDING' ? 'нет проверенного аудио' : 'на проверке'}</span></div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </motion.div>
        </AnimatePresence>

        <div className="row between mt16">
          <button className="btn outline" type="button" disabled={idx <= 0} onClick={() => go(tabs[idx - 1].key)}>Назад</button>
          {idx < tabs.length - 1 ? (
            <button className="btn" type="button" onClick={() => go(tabs[idx + 1].key)}>Дальше: {tabs[idx + 1].title} <Icon name="arrow" size={14} /></button>
          ) : !props.preview ? (
            done ? (props.nextUnit ? <Link className="btn" href={`/lesson/${props.nextUnit.unit_id}`} transitionTypes={['nav-forward']}>Следующий урок <Icon name="arrow" size={14} /></Link> : <Link className="btn" href="/course">К маршруту</Link>)
              : <button className="btn dark" type="button" onClick={complete}>Завершить урок</button>
          ) : null}
        </div>
        {msg ? <p className="error-text" role="alert">{msg}</p> : null}
        {done ? <div className="banner ok mt16" role="status"><Icon name="check" /><span><strong>Урок завершён и сохранён.</strong> Повторения D1–D28 поставлены по вашему календарю; освоение засчитают самостоятельные ответы и отсроченные проверки.</span></div> : null}
      </div>

      <aside className="stack">
        <div className="card cardpad">
          <div className="card-top"><div className="card-title"><Icon name="check" /> Прогресс урока</div><span className="mono small">{pct}%</span></div>
          <div className="progress-track"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
          <p className="tiny quiet" style={{ margin: '8px 0 14px' }}>Ответов: <b>{answeredCount}</b> из {total} доступных{props.devPreview ? ' (DEV-PREVIEW)' : ''}.</p>
          <div className="lesson-steps">
            {tabs.map((t, i) => (
              <button key={t.key} type="button" className={`lesson-step ${tab === t.key ? 'active' : ''} ${tab !== t.key && stepDone(t.key) ? 'done' : ''}`} onClick={() => go(t.key)}>
                <span className="dotn">{tab !== t.key && stepDone(t.key) ? <Icon name="check" size={13} /> : i + 1}</span>
                <span><b>{t.title}</b><small>{STEP_HINT[t.key] ?? ''}</small></span>
              </button>
            ))}
          </div>
        </div>
        <div className="card cardpad">
          <div className="card-title"><Icon name="rotate" /> Когда повторим</div>
          <p className="small quiet" style={{ marginBottom: 0 }}>После первого самостоятельного верного ответа: D1, D3, D7, D14, D28 по вашему календарю.{props.retentionCount ? ` ${props.retentionCount} заданий для отсроченных проверок ждут своего дня.` : ''}</p>
        </div>
        <div className="tip">
          <Icon name="info" />
          <div className="small" style={{ color: 'var(--ink-2)' }}>
            <b style={{ color: 'var(--ink)' }}>Статус материала.</b> Один правильный ответ не открывает уровень. QA: {props.qa.status} · преподаватель: {props.qa.human === 'NOT_REVIEWED' ? 'не проверял' : props.qa.human} · аудио: {props.qa.audio === 'MISSING_AUDIO' ? 'нет в корпусе' : props.qa.audio}.
          </div>
        </div>
      </aside>
    </div>
  );
}
