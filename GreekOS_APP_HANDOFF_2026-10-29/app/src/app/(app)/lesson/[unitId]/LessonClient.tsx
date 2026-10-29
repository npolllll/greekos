'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ItemDTO } from '@/lib/content/dto';
import { ItemPlayer } from '@/components/ItemPlayer';
import { Icon } from '@/components/Icon';

export interface LessonStep {
  key: string;
  title: string;
  items: ItemDTO[];
  locked: Array<{ item_id: string; reason: string }>;
}

export function LessonClient(props: {
  unitId: string;
  unitHash: string;
  preview: boolean;
  sessionId: string | null;
  completed: boolean;
  theory: string;
  objectives: string[];
  examples: string[];
  vocabulary: Array<{ lemma: string; inflection: string; meaning: string; example: string }>;
  steps: LessonStep[];
  retentionCount: number;
  qa: { status: string; human: string; audio: string };
}) {
  const router = useRouter();
  const tabs = [{ key: 'theory', title: 'Объяснение' }, { key: 'examples', title: 'Примеры и слова' }, ...props.steps.map((s) => ({ key: s.key, title: s.title }))];
  const [tab, setTab] = useState('theory');
  const [answered, setAnswered] = useState<Set<string>>(new Set());
  const [sessionId, setSessionId] = useState(props.sessionId);
  const [done, setDone] = useState(props.completed);
  const [msg, setMsg] = useState<string | null>(null);
  const started = useRef(false);
  const total = props.steps.reduce((a, s) => a + s.items.length, 0);

  useEffect(() => {
    if (props.preview || started.current || sessionId) return;
    started.current = true;
    fetch('/api/lessons/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ unit_id: props.unitId, unit_hash: props.unitHash }) })
      .then((r) => r.json()).then((j) => j.session_id && setSessionId(j.session_id)).catch(() => undefined);
  }, [props.preview, props.unitId, props.unitHash, sessionId]);

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

  return (
    <div className="lesson-layout">
      <div>
        <div className="steps" role="tablist" aria-label="Этапы урока">
          {tabs.map((t, i) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`step ${tab === t.key ? 'active' : ''} ${i < idx ? 'done' : ''}`} onClick={() => setTab(t.key)}>
              <span className="n">{i + 1}</span>{t.title}
            </button>
          ))}
        </div>

        {tab === 'theory' ? (
          <div className="card cardpad lesson-panel active">
            {props.objectives.length ? <ul className="criteria" style={{ marginBottom: 14 }}>{props.objectives.map((o) => <li key={o}>{o}</li>)}</ul> : null}
            <div className="theory">{props.theory || 'Объяснение для этого урока не заполнено.'}</div>
          </div>
        ) : null}

        {tab === 'examples' ? (
          <div className="stack lesson-panel active">
            <div className="card cardpad">
              <div className="card-title" style={{ marginBottom: 10 }}><Icon name="book" /> Примеры</div>
              {props.examples.map((e) => <div className="example" key={e}><span className="greek-serif" lang="el" style={{ fontSize: 19 }}>{e}</span></div>)}
              <p className="disclosure">Озвучка примеров появится после цифровой проверки аудио. Сейчас — без звука, честно.</p>
            </div>
            {props.vocabulary.length ? (
              <div className="card cardpad">
                <div className="card-title" style={{ marginBottom: 10 }}><Icon name="layers" /> Слова урока</div>
                <div className="vocab">{props.vocabulary.map((v) => <div key={v.lemma}><b lang="el">{v.lemma}</b><small>{v.meaning}</small><small lang="el">{v.inflection}</small>{v.example ? <small lang="el">{v.example}</small> : null}</div>)}</div>
              </div>
            ) : null}
          </div>
        ) : null}

        {step ? (
          <div className="stack lesson-panel active">
            {step.items.length === 0 && step.locked.length === 0 ? <div className="card empty"><strong>В этом этапе нет заданий</strong></div> : null}
            {step.items.map((it) => (
              <ItemPlayer key={it.item_id} item={it} context="lesson" contextRef={sessionId ?? undefined} preview={props.preview} onResult={() => setAnswered((s) => new Set(s).add(it.item_id))} />
            ))}
            {step.locked.length ? (
              <div className="card cardpad">
                <div className="card-title"><Icon name="lock" /> Закрытые задания этого этапа</div>
                {step.locked.map((l) => (
                  <div className="locked-item" key={l.item_id}><span className={`lock-dot ${l.reason === 'AUDIO_PENDING' ? 'audio' : ''}`} />{l.item_id}<span className="muted" style={{ marginLeft: 'auto' }}>{l.reason === 'AUDIO_PENDING' ? 'аудио пока недоступно' : 'на проверке'}</span></div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="row between mt16">
          <button className="btn outline" type="button" disabled={idx <= 0} onClick={() => setTab(tabs[idx - 1].key)}>Назад</button>
          {idx < tabs.length - 1 ? <button className="btn" type="button" onClick={() => setTab(tabs[idx + 1].key)}>Дальше <Icon name="arrow" size={14} /></button> : !props.preview ? <button className="btn dark" type="button" onClick={complete} disabled={done}>{done ? 'Урок завершён' : 'Завершить урок'}</button> : null}
        </div>
        {msg ? <p className="error-text" role="alert">{msg}</p> : null}
      </div>

      <aside className="stack">
        <div className="card cardpad">
          <div className="card-title"><Icon name="check" /> Ход урока</div>
          <p className="small quiet">Ответов в этом визите: <b>{answered.size}</b> из {total} доступных.</p>
          <div className="progress-track"><div className="progress-fill" style={{ width: `${total ? Math.round((answered.size / total) * 100) : 0}%` }} /></div>
          <div className="subtle-divider" />
          <div className="card-title"><Icon name="rotate" /> Когда повторим</div>
          <p className="small quiet">После первого самостоятельного верного ответа: D1, D3, D7, D14, D28 по вашему календарю. {props.retentionCount ? `${props.retentionCount} заданий для отсроченных проверок ждут своего дня.` : ''}</p>
        </div>
        <div className="card cardpad">
          <div className="card-title"><Icon name="info" /> Проверка обучения</div>
          <p className="small quiet">Один правильный ответ не открывает уровень. Важны самостоятельная продукция, перенос и отсроченное сохранение.</p>
          <div className="pill-row"><span className="tag gray">QA: {props.qa.status}</span><span className="tag gray">Преподаватель: {props.qa.human === 'NOT_REVIEWED' ? 'не проверял' : props.qa.human}</span><span className="tag gray">Аудио: {props.qa.audio === 'MISSING_AUDIO' ? 'нет' : props.qa.audio}</span></div>
        </div>
      </aside>
    </div>
  );
}
