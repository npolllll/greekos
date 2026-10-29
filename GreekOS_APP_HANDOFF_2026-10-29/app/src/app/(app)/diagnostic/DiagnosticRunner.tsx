'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { DiagView } from '@/lib/diagnostic/service';
import { Icon } from '@/components/Icon';
import { VoiceAnswer } from '@/components/VoiceAnswer';

const AXIS_RU: Record<string, string> = { grammar: 'Грамматика', vocabulary: 'Лексика', reading: 'Чтение', listening: 'Аудирование', writing: 'Письмо', spoken_interaction: 'Устное взаимодействие', spoken_production: 'Устная речь', pronunciation: 'Произношение' };
const REASON_RU: Record<string, string> = {
  AUDIO_MISSING: 'нет проверенного аудио — не проводилось', ACOUSTIC_ASSESSMENT_NOT_AVAILABLE: 'произношение оценивается только по звуку; акустическая оценка не подключена',
  ASR_NOT_CONFIGURED: 'распознавание речи не подключено — письменный ответ не измеряет говорение', CONTENT_GATED: 'задания на проверке', NO_PROBE: 'нет пробы',
  LEARNER_STOPPED: 'вы остановили этот навык', NOT_REACHED: 'не дошли до этого навыка', ASSISTED: 'ответ с помощью', UNCERTAIN_ASSESSMENT: 'ответ ждёт проверки',
};
const STATUS_RU: Record<string, string> = { OBSERVED: 'Наблюдалось', NOT_OBSERVED: 'Не оценено', PENDING_REVIEW: 'Ждёт проверки', STOPPED: 'Остановлено', NO_RELEASED_CONTENT: 'Задания на проверке', IN_PROGRESS: 'Впереди' };

function key() { return crypto.randomUUID(); }

export function DiagnosticRunner({ initial, entryPath, voice }: { initial: DiagView; entryPath: string | null; voice: boolean }) {
  const router = useRouter();
  const [view, setView] = useState<DiagView>(initial);
  const [choice, setChoice] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const idem = useRef(key());

  async function call(body: Record<string, unknown>) {
    setBusy(true); setErr(null);
    try {
      const r = await fetch('/api/diagnostic', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j.message ?? 'Ошибка'); return; }
      const v = (j.view ?? j) as DiagView;
      setView(v); setChoice(null); setText(''); idem.current = key();
      router.refresh();
    } catch {
      setErr('Нет связи. Ответ можно отправить ещё раз — дубль не возникнет.');
    } finally { setBusy(false); }
  }

  const answer = (response: { choice?: string; text?: string }, source: 'typed' | 'asr_confirmed') => view.current && call({ action: 'answer', session_id: view.session_id, item_id: view.current.item_id, content_hash: view.current.content_hash, response, response_source: source, idempotency_key: idem.current });

  if (view.status === 'NONE') {
    return (
      <>
        <div className="screen-head"><div><div className="eyebrow">GreekOS / Определение уровня</div><h1 className="screen-title">Диагностика по навыкам</h1><p className="screen-sub">Предварительная точка входа, не сертификат и не окончательный CEFR.</p></div></div>
        <div className="placement-layout">
          <div className="card placement-panel">
            <span className="tag green">{entryPath === 'from_zero' ? 'Необязательно для старта с нуля' : 'Рекомендуется перед началом'}</span>
            <h2 className="placement-title">Каждый навык — отдельно</h2>
            <p>По каждому из восьми навыков начинаем с A1. Верный самостоятельный ответ открывает следующий уровень того же навыка, ошибка завершает подъём. Подсказок нет. Можно остановить навык или всю диагностику в любой момент.</p>
            <div className="placement-steps">
              {['Грамматика, лексика, чтение — письменные пробы', 'Аудирование — только с проверенным звуком', 'Письмо — оценка по критериям с правом воздержаться', 'Говорение — только голосом; произношение по тексту не оценивается'].map((t, i) => <div key={t}><span className="placement-step-number">{i + 1}</span><b>{t}</b></div>)}
            </div>
            <button className="btn" type="button" disabled={busy} onClick={() => call({ action: 'start' })}>Начать диагностику <Icon name="arrow" size={14} /></button>
            {err ? <p className="error-text" role="alert">{err}</p> : null}
          </div>
          <aside className="card cardpad"><div className="card-title"><Icon name="info" /> Честные границы</div><p className="small quiet">24 короткие пробы A1–B1 из корпуса — не калиброванный тест. B2 не измеряется. Результат — профиль навыков с неопределённостью и временный маршрут, который пересматривается после первых недель обучения.</p></aside>
        </div>
      </>
    );
  }

  if (view.status === 'COMPLETED' && view.result) {
    const res = view.result as { axes: Array<{ axis: string; status: string; demonstrated: string | null; candidate_start: string | null; reason: string | null }>; route_level: string | null; disclaimer: string };
    return (
      <>
        <div className="screen-head"><div><div className="eyebrow">GreekOS / Результат диагностики</div><h1 className="screen-title">Результат диагностики</h1><p className="screen-sub">Предварительная точка входа, не сертификат и не окончательный CEFR.</p></div></div>
        <div className="placement-layout">
          <div className="card placement-panel">
            <span className="tag green">Предварительная рекомендация</span>
            <h2 className="placement-title" style={{ fontSize: 'clamp(28px,3vw,42px)' }}>{res.route_level === 'FOUNDATIONS' ? 'Старт с основ чтения' : res.route_level ? `${res.route_level} · ориентир` : 'Данных недостаточно'}</h2>
            <p>{res.route_level ? 'Маршрут назначен консервативно по грамматике, лексике и чтению. Сильные навыки не заставят повторять всё: ранние уроки помечены «можно пропустить».' : 'Недостаточно наблюдений для маршрута. Выберите старт вручную вместе с владельцем или продолжите с основ.'}</p>
            {res.axes.map((a) => (
              <div className="plan-row" key={a.axis}><span className="plan-text">{AXIS_RU[a.axis]}</span>
                <span className="tag gray">{a.status === 'OBSERVED' ? (a.demonstrated ? `показан ${a.demonstrated} · старт ${a.candidate_start}` : `старт ${a.candidate_start ?? 'A1'}`) : `${STATUS_RU[a.status]}${a.reason && REASON_RU[a.reason] ? ` — ${REASON_RU[a.reason]}` : ''}`}</span></div>
            ))}
            <div className="warning-note">{res.disclaimer} Никаких автоматических утверждений «уровень B1/B2 подтверждён».</div>
            <Link className="btn" href="/course">Открыть маршрут <Icon name="arrow" size={14} /></Link>
          </div>
          <aside className="card cardpad"><div className="card-title"><Icon name="layers" /> Что дальше</div><p className="small quiet">Профиль по навыкам хранится у вас и виден владельцу. Через 2–4 недели маршрут пересматривается по реальным ответам, письму, речи и D7-проверкам.</p></aside>
        </div>
      </>
    );
  }

  const axes = view.state?.axes ?? [];
  const cur = view.current;
  return (
    <>
      <div className="screen-head"><div><div className="eyebrow">GreekOS / Определение уровня</div><h1 className="screen-title">{view.current_axis ? AXIS_RU[view.current_axis] : 'Диагностика'}</h1><p className="screen-sub">Без подсказок. Если задание непосильно — это тоже результат: можно перейти к следующему навыку.</p></div></div>
      <div className="placement-layout">
        <div className="card placement-panel">
          {cur ? (
            <>
              <span className="tag gray">{cur.level} · проба</span>
              <h2 className="placement-title" lang="el" style={{ fontFamily: 'Georgia, serif', fontWeight: 400 }}>{cur.prompt}</h2>
              {cur.stimulus?.text ? <div className="stimulus" lang="el">{cur.stimulus.text}</div> : null}
              {view.voice_required ? (
                voice ? <VoiceAnswer disabled={busy} allowEdit={false} onConfirmed={(t) => answer({ text: t }, 'asr_confirmed')} />
                  : <div className="banner warn"><Icon name="mic" /><span>Распознавание речи не подключено — этот навык будет отмечен как «не оценено».</span></div>
              ) : cur.response_kind === 'choice' ? (
                <div className="placement-choices" role="radiogroup">{cur.options.map((o) => <button key={o.key} type="button" role="radio" aria-checked={choice === o.key} className={`placement-choice ${choice === o.key ? 'selected' : ''}`} onClick={() => setChoice(o.key)} lang="el">{o.label}</button>)}</div>
              ) : cur.response_kind === 'open_text' ? (
                <textarea className="placement-textarea greek-input" lang="el" aria-label="Ваш ответ" value={text} onChange={(e) => setText(e.target.value)} />
              ) : (
                <input className="input greek-input" lang="el" aria-label="Ваш ответ" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" spellCheck={false} />
              )}
              {err ? <p className="error-text" role="alert">{err}</p> : null}
              <div className="placement-footer">
                <button className="btn outline" type="button" disabled={busy} onClick={() => call({ action: 'skip_axis', session_id: view.session_id })}>Пропустить навык</button>
                {!view.voice_required ? <button className="btn" type="button" disabled={busy || (cur.response_kind === 'choice' ? choice === null : !text.trim())} onClick={() => answer(cur.response_kind === 'choice' ? { choice: choice! } : { text }, 'typed')}>{busy ? 'Сохраняю…' : 'Ответить'}</button> : voice ? null : <button className="btn" type="button" onClick={() => call({ action: 'skip_axis', session_id: view.session_id })}>Дальше</button>}
              </div>
            </>
          ) : (
            <>
              <h2 className="placement-title">Пробы закончились</h2>
              <p>Подведём итог по наблюдённым навыкам. Неоценённые навыки останутся отмеченными явно.</p>
              <button className="btn" type="button" disabled={busy} onClick={() => call({ action: 'finish', session_id: view.session_id })}>Показать результат</button>
            </>
          )}
        </div>
        <aside className="card cardpad">
          <div className="card-title"><Icon name="layers" /> Навыки</div>
          {axes.map((a) => <div className="placement-feature" key={a.axis}><span className={`lock-dot ${a.status === 'OBSERVED' ? 'ok' : a.status === 'IN_PROGRESS' ? 'audio' : ''}`} />{AXIS_RU[a.axis]}<span className="tiny muted" style={{ marginLeft: 'auto' }}>{STATUS_RU[a.status]}</span></div>)}
          {cur ? <button className="text-link mt16" type="button" onClick={() => call({ action: 'finish', session_id: view.session_id })}>Завершить сейчас</button> : null}
        </aside>
      </div>
    </>
  );
}
