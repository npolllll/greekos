'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ViewTransition } from 'react';
import type { SessionView } from '@/lib/speaking/service';
import { MODE_LABEL_RU, STATE_LABEL_RU, type VoiceState } from '@/lib/speaking/state-machine';
import { Icon } from '@/components/Icon';
import { VoiceAnswer, type Transcript } from '@/components/VoiceAnswer';
import { useVoiceStream, STREAM_LABEL_RU, streamSupported } from '@/components/useVoiceStream';
import type { Speed } from '@/lib/speaking/stream-protocol';
import { LevelOrb, ConfirmTranscript } from './StreamParts';

interface HelpResult { kind: string; answer_ru: string; example_el: string | null; source: string; note: string | null }

const DIM_RU: Record<string, string> = { task_success: 'Коммуникативная задача', interaction: 'Взаимодействие', language: 'Язык', register: 'Регистр' };
const LVL_RU: Record<string, string> = { independent: 'самостоятельно', with_help: 'с помощью', not_demonstrated: 'не показано', not_assessable: 'не оценивается' };

const LIVE = new Set(['connecting', 'listening', 'speech', 'transcribing', 'confirming', 'thinking', 'speaking', 'paused', 'network_lost']);
const SPEED_RU: Record<Speed, string> = { normal: 'обычно', slow: 'медленнее', fast: 'чуть быстрее' };

export function SpeakingStage({ initial, defaultRate }: { initial: SessionView; defaultRate: 'slow' | 'normal' }) {
  const [view, setView] = useState<SessionView>(initial);
  // Streaming duplex when the session asked for it and the browser supports it; otherwise the
  // step-by-step (record → check → send) fallback, honestly labelled as less interactive.
  const [streamFallback, setStreamFallback] = useState<string | null>(null);
  const wantsStream = initial.input_mode === 'voice' && initial.transport !== 'batch';
  const [state, setState] = useState<VoiceState>(initial.status === 'ENDED' ? 'ended' : 'ready');
  const [showText, setShowText] = useState(initial.mode === 'a0_guided' || initial.input_mode === 'text_fallback' || !initial.providers.tts);
  const [typed, setTyped] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpRes, setHelpRes] = useState<HelpResult | null>(null);
  const [helpQ, setHelpQ] = useState('');
  const [helpUsed, setHelpUsed] = useState<string[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [idle, setIdle] = useState(false);
  const [engineNote, setEngineNote] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, unknown> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playingTurn = useRef<string | null>(null);
  const spokenTurns = useRef<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const hintsAllowed = view.hints_allowed;
  const stream = useVoiceStream({
    sessionId: initial.session_id,
    initialSpeed: initial.mode === 'b2_mock' ? 'normal' : defaultRate,
    onView: (v) => setView(v as SessionView),
    onTurnMeta: (m) => { setHint(m.hint_ru); setEngineNote(m.engine === 'scripted_fallback' ? 'AI-диалог не подключён: собеседник идёт по авторскому сценарию, свободные ответы не оцениваются.' : null); },
  });
  const fallback = streamFallback ?? (wantsStream && stream.status === 'unsupported' ? stream.error ?? 'браузер не поддерживает потоковый звук' : null);
  const streamUi = wantsStream && !fallback;
  const streamOn = streamUi && LIVE.has(stream.status);

  const post = useCallback(async (body: Record<string, unknown>) => {
    const r = await fetch('/api/speaking', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.message ?? 'Ошибка'), { status: r.status, code: j.error });
    return j;
  }, []);

  const play = useCallback(async (turnId: string, rate: 'slow' | 'normal') => {
    if (!view.providers.tts) return;
    try {
      setState('agent_responding');
      const j = await post({ action: 'speak', session_id: view.session_id, turn_id: turnId, rate });
      if (!j.url) { setState('ready'); return; }
      audioRef.current?.pause();
      const a = new Audio(j.url);
      audioRef.current = a;
      playingTurn.current = turnId;
      a.onended = () => { playingTurn.current = null; setState('ready'); };
      a.onerror = () => { playingTurn.current = null; setState('ready'); };
      setState('agent_speaking');
      await a.play();
    } catch (e) {
      setState('ready');
      setErr((e as Error).message);
      setShowText(true);
    }
  }, [post, view.providers.tts, view.session_id]);

  // Auto-play each new assistant line once (silent mode / reduced motion do not block audio).
  useEffect(() => {
    const last = [...view.turns].reverse().find((t) => t.speaker === 'assistant');
    if ((!wantsStream || fallback) && last && !spokenTurns.current.has(last.turn_id) && view.status === 'ACTIVE') {
      spokenTurns.current.add(last.turn_id);
      void play(last.turn_id, defaultRate);
    }
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [view.turns, view.status, play, defaultRate, wantsStream, fallback]);



  // Silence: one neutral invitation, no penalty.
  useEffect(() => {
    if (state !== 'ready') return;
    const t = setTimeout(() => setIdle(true), 25_000);
    return () => clearTimeout(t);
  }, [state, view.turns.length]);

  // Network recovery: refetch authoritative state; confirmed turns are already on the server.
  useEffect(() => {
    const onOff = () => setState((s) => (s === 'ended' ? s : 'network_lost'));
    const onOn = async () => {
      try { setView(await post({ action: 'state', session_id: view.session_id })); setState('session_recovered'); setTimeout(() => setState('ready'), 1200); } catch { /* still offline */ }
    };
    window.addEventListener('offline', onOff);
    window.addEventListener('online', onOn);
    return () => { window.removeEventListener('offline', onOff); window.removeEventListener('online', onOn); };
  }, [post, view.session_id]);

  function bargeIn(): boolean {
    if (playingTurn.current && audioRef.current && !audioRef.current.paused) {
      audioRef.current.pause();
      playingTurn.current = null;
      return true;
    }
    return false;
  }

  async function sendTurn(body: { text: string; source: 'asr_confirmed' | 'learner_corrected' | 'typed'; asr_confidence: number | null; repair?: boolean }) {
    setErr(null); setHint(null); setIdle(false);
    const interrupted = bargeIn();
    const payload = { action: 'turn', session_id: view.session_id, text: body.text, source: body.source, asr_confidence: body.asr_confidence, help_used: helpUsed, repair: !!body.repair, interrupted_previous: interrupted, idempotency_key: crypto.randomUUID() };
    setPending(payload);
    setState('agent_responding');
    try {
      const j = await post(payload);
      setView(j);
      setHelpUsed([]);
      setPending(null);
      setTyped('');
      if (j.hint_ru) setHint(j.hint_ru);
      setEngineNote(j.engine === 'scripted_fallback' ? 'AI-диалог недоступен: собеседник идёт по сценарию, ответ не оценивается.' : null);
      setState('ready');
    } catch (e) {
      const ex = e as Error & { status?: number };
      if (!ex.status) { setState('network_lost'); setErr('Соединение прервалось. Нажмите «Отправить снова» — дубль не возникнет.'); }
      else { setPending(null); setState('ready'); setErr(ex.message); }
    }
  }

  async function retryPending() {
    if (!pending) return;
    setState('agent_responding');
    try { const j = await post(pending); setView(j); setPending(null); setErr(null); setState('ready'); } catch { setState('network_lost'); }
  }

  async function askHelp(kind: 'hint' | 'translate' | 'explain' | 'how_to_say' | 'why') {
    setHelpOpen(true); setHelpRes(null);
    if (streamOn) { stream.interrupt(); stream.helpUsed(kind); }
    try {
      const j = await post({ action: 'help', session_id: view.session_id, kind, question: helpQ || undefined });
      setHelpRes(j);
      setHelpUsed((h) => (h.includes(kind) ? h : [...h, kind]));
    } catch (e) { setHelpRes({ kind, answer_ru: (e as Error).message, example_el: null, source: 'error', note: null }); }
  }

  async function end() {
    bargeIn();
    stream.stop();
    setState('ending');
    try { setView(await post({ action: 'end', session_id: view.session_id })); setState('ended'); } catch (e) { setErr((e as Error).message); setState('failed'); }
  }

  const lastAssistant = [...view.turns].reverse().find((t) => t.speaker === 'assistant');
  const summary = view.summary as null | { status: string; reason?: string; label?: string; communicative_goal?: string; dimensions?: Array<{ dimension: string; level: string; note_ru: string }>; corrections?: Array<{ quote: string; better_el: string; why_ru: string; kind: string }>; next_step_ru?: string; mastery_counted?: boolean; mastery_reason?: string; confidence?: string };

  const initial0 = (view.persona.voice_name ?? 'Α').replace(/[^\p{L}]/gu, '').slice(0, 1) || 'Α';
  const statusLabel = streamUi ? STREAM_LABEL_RU[stream.status] : STATE_LABEL_RU[state];
  const turnClass = streamUi ? (stream.speakingTurn ? 'speaking' : stream.status === 'thinking' || stream.status === 'transcribing' ? 'thinking' : ['listening', 'speech'].includes(stream.status) ? 'listening' : '') : state === 'agent_speaking' ? 'speaking' : state === 'agent_responding' || state === 'transcribing' ? 'thinking' : state === 'listening' ? 'listening' : '';

  return (
    <>
      <div className="screen-head" style={{ marginBottom: 14 }}>
        <div>
          <Link href="/speaking" className="tiny quiet" style={{ textDecoration: 'none' }} transitionTypes={['nav-back']}>← Все сценарии</Link>
          <ViewTransition name={`scenario-${view.scenario_id}`} share="morph" default="none"><h1 className="screen-title">{view.domain ?? view.title}</h1></ViewTransition>
          <p className="screen-sub">{view.level} · {MODE_LABEL_RU[view.mode]} · {view.input_mode === 'voice' ? 'голос' : 'текстовый режим (не говорение)'}{view.preview ? ' · предпросмотр' : ''}</p>
        </div>
        <span className="pill" title="Кто ведёт диалог"><Icon name="spark" size={14} /> {view.providers.llm ? view.engine_label : 'Сценарный режим: без AI, без оценки'}</span>
      </div>
      <div className="voice-layout">
        <div className={`voice-stage ${view.preview ? 'watermark' : ''}`}>
          <div className="scene-card">
            <div className="thumb" style={{ width: 84, height: 84, ['--tx' as string]: '16%', ['--ty' as string]: '82%', ['--ts' as string]: '320%' }} aria-hidden="true" />
            <div style={{ minWidth: 0 }}>
              <span className="eyebrow">Ситуация</span>
              <b style={{ display: 'block', fontSize: 16, margin: '2px 0 4px' }}>{view.domain ?? view.scenario_id}</b>
              <p className="small" style={{ margin: 0, color: 'var(--ink-2)' }}>{view.goal_ru ?? view.objective_ru}</p>
            </div>
          </div>
          <div className="row between" style={{ margin: '12px 0 4px' }}>
            <span className={`turn-state ${turnClass}`} role="status" aria-live="polite"><i aria-hidden="true" />{statusLabel}</span>
            {view.input_mode === 'voice' ? <span className="tiny quiet">{wantsStream && !fallback ? 'Живой потоковый разговор' : 'Пошаговый режим'}{view.persona.voice_name ? ` · голос ${view.persona.voice_name}${view.persona.dev_only ? ' (dev)' : ''}` : ''}</span> : null}
          </div>
          <div className="transcript" ref={listRef} aria-live="polite">
            {view.turns.map((t) => (
              <div key={t.turn_id} className={`msg ${t.speaker === 'learner' ? 'mine' : ''}`}>
                {t.speaker === 'assistant' ? <span className="avatar persona" aria-hidden="true">{initial0}</span> : null}
                <div className={`bubble ${t.speaker === 'learner' ? 'my' : 'greek'}`} lang={t.speaker === 'assistant' ? 'el' : undefined}>
                  {t.speaker === 'assistant' && !showText && t.turn_id === lastAssistant?.turn_id ? <span className="muted">(текст скрыт — нажмите «Текст»)</span> : t.text}
                  <span className="meta">
                    {t.speaker === 'assistant' ? (t.generated ? 'AI-реплика (черновик)' : 'Реплика сценария') : t.source === 'asr_confirmed' ? 'Распознано и подтверждено' : t.source === 'asr_auto' ? 'Распознано (уверенно), без правки' : t.source === 'learner_corrected' ? 'Распознавание исправлено вами' : 'Набрано текстом'}
                    {t.interrupted ? ' · прервано' : ''}{t.help.some((h) => !h.startsWith('hint:')) ? ' · с подсказкой' : ''}
                  </span>
                </div>
              </div>
            ))}
            {streamOn && stream.partial ? <div className="msg mine"><div className="bubble my draft" lang="el">{stream.partial}<span className="meta">Черновик распознавания — ещё не отправлено</span></div></div> : null}
          </div>
          {streamOn && stream.pending ? <ConfirmTranscript key={stream.pending.utterance_id} pending={stream.pending} onConfirm={stream.confirm} onDiscard={stream.discard} /> : null}
          {streamOn && stream.notice ? <p className="small muted" role="status">{stream.notice}</p> : null}
          {wantsStream && stream.error && !fallback ? <p className="error-text" role="alert">{stream.error}</p> : null}
          {fallback ? <div className="banner warn mt8"><Icon name="info" /><span>Потоковый режим недоступен ({fallback}). Включён пошаговый режим: запись → проверка текста → отправка. Он менее интерактивный.</span></div> : null}
          {hint ? <div className="context-insight">{hint}</div> : null}
          {idle && state === 'ready' ? <p className="small muted">Не торопитесь. Можно попросить повторить, замедлить или взять подсказку.</p> : null}
          {engineNote ? <div className="banner warn mt8"><Icon name="info" /><span>{engineNote}</span></div> : null}
          {err ? <p className="error-text" role="alert">{err}</p> : null}
          {pending && state === 'network_lost' ? <button className="btn" type="button" onClick={retryPending}>Отправить снова</button> : null}

          {view.status === 'ACTIVE' && state !== 'ending' ? (
            <div className="mic-dock">
              {wantsStream && !fallback ? (
                <>
                  {streamUi ? <LevelOrb level={stream.status === 'speaking' || stream.speakingTurn ? stream.outLevel : stream.micLevel} speaking={!!stream.speakingTurn} active={stream.status !== 'paused'} /> : null}
                  <div className="stream-bar">
                    {stream.status === 'idle' || stream.status === 'error' || stream.status === 'permission_denied' ? (
                      <button className="btn" type="button" onClick={() => { if (!streamSupported()) setStreamFallback('браузер не поддерживает потоковый звук'); else void stream.start(); }}><Icon name="mic" /> {stream.status === 'idle' ? 'Начать разговор' : 'Подключиться снова'}</button>
                    ) : (
                      <>
                        {stream.speakingTurn ? <button className="btn" type="button" onClick={() => stream.interrupt()}>Перебить / говорить</button> : null}
                        {stream.status === 'speech' ? <button className="btn" type="button" onClick={stream.done}>Готово</button> : null}
                        {stream.status === 'paused' ? <button className="btn outline" type="button" onClick={stream.resume}>Продолжить</button> : <button className="btn outline" type="button" onClick={stream.pause}>Пауза</button>}
                        <button className="btn flat" type="button" onClick={stream.stop}>Остановить</button>
                      </>
                    )}
                  </div>
                  {stream.status === 'permission_denied' ? <p className="error-text" role="alert">Нет доступа к микрофону. Разрешите его в настройках браузера или продолжите текстом в новом разговоре (не засчитывается как говорение).</p> : null}
                  <div className="chip-row" role="radiogroup" aria-label="Темп речи собеседника" style={{ justifyContent: 'center' }}>
                    {(view.mode === 'b2_mock' ? (['normal'] as Speed[]) : (['normal', 'slow', 'fast'] as Speed[])).map((sp) => (
                      <button key={sp} type="button" role="radio" aria-checked={stream.speed === sp} className={`chip ${stream.speed === sp ? 'active' : ''}`} onClick={() => stream.setSpeed(sp)}>{SPEED_RU[sp]}</button>
                    ))}
                    <label className="chip" style={{ cursor: 'pointer' }}><input type="checkbox" checked={stream.autoBargeIn} onChange={(e) => stream.setAutoBargeIn(e.target.checked)} /> Перебивать голосом</label>
                  </div>
                </>
              ) : view.input_mode === 'voice' ? (
                <>
                  <div className={`voice-orb ${state === 'agent_speaking' ? 'out' : ''}`} aria-hidden="true"><Icon name={state === 'agent_speaking' ? 'volume' : 'mic'} /></div>
                  <VoiceAnswer sessionId={view.session_id} disabled={state === 'agent_responding'} allowEdit onConfirmed={(text, tr: Transcript) => sendTurn({ text, source: tr.edited ? 'learner_corrected' : 'asr_confirmed', asr_confidence: tr.confidence })} onDenied={() => setErr('Нет доступа к микрофону. Можно продолжить текстом в новом разговоре — он не засчитывается как говорение.')} />
                </>
              ) : (
                <div className="field" style={{ width: '100%' }}>
                  <label htmlFor="typed">Ваша реплика по-гречески (текстовый режим не засчитывается как говорение)</label>
                  <textarea id="typed" className="greek-input" lang="el" value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && typed.trim()) { e.preventDefault(); void sendTurn({ text: typed, source: 'typed', asr_confidence: null }); } }} />
                  <button className="btn" type="button" disabled={!typed.trim() || state === 'agent_responding'} onClick={() => sendTurn({ text: typed, source: 'typed', asr_confidence: null })}>Отправить</button>
                </div>
              )}
              <div className="voice-controls">
                {lastAssistant && view.providers.tts ? <button className="chip" type="button" disabled={streamUi && !streamOn} onClick={() => (streamOn ? stream.replay(lastAssistant.turn_id, stream.speed) : play(lastAssistant.turn_id, 'normal'))}><Icon name="replay" size={14} /> Повтори</button> : null}
                {lastAssistant && view.providers.tts && view.mode !== 'b2_mock' ? <button className="chip" type="button" disabled={streamUi && !streamOn} onClick={() => (streamOn ? stream.replay(lastAssistant.turn_id, 'slow') : play(lastAssistant.turn_id, 'slow'))}>Помедленнее</button> : null}
                <button className="chip" type="button" aria-pressed={showText} onClick={() => setShowText((s) => !s)}>Текст</button>
                <button className="chip" type="button" onClick={() => (streamOn ? stream.repair() : sendTurn({ text: '', source: 'typed', asr_confidence: null, repair: true }))}>Не понял(а)</button>
                {hintsAllowed ? <button className="chip" type="button" onClick={() => setHelpOpen(true)}>Что значит / Как сказать / Почему так?</button> : null}
              </div>
              <button className="btn dark end-btn" type="button" onClick={end}><Icon name="stop" size={15} /> Завершить разговор</button>
            </div>
          ) : null}

          {view.status === 'ENDED' && summary ? (
            <div className="context-coach">
              <div className="context-eyebrow">ИТОГ РАЗГОВОРА</div>
              {summary.status === 'ASSESSED_PROVISIONAL' ? (
                <>
                  <div className="context-head"><div><h4>Цель: {summary.communicative_goal === 'achieved' ? 'достигнута' : summary.communicative_goal === 'partially' ? 'частично' : summary.communicative_goal === 'not_achieved' ? 'не достигнута' : 'неясно'}</h4><p>{summary.label}</p></div><span className="ai-label">AI · уверенность {summary.confidence}</span></div>
                  {summary.dimensions?.map((d) => <div className="plan-row" key={d.dimension}><span className="plan-text">{DIM_RU[d.dimension]}</span><span className="tag gray">{LVL_RU[d.level]}</span></div>)}
                  {summary.corrections?.length ? <div className="card-title mt16" style={{ fontSize: 13.5 }}>Главное исправить ({summary.corrections.length})</div> : null}
                  {summary.corrections?.map((c, i) => <div className="context-insight" key={i}><span lang="el">«{c.quote}» → <b>{c.better_el}</b></span> — {c.why_ru}{c.kind === 'style_suggestion' ? ' (стилистика, не ошибка)' : ''}</div>)}
                  <p className="small mt8">{summary.next_step_ru}</p>
                  <p className="tiny muted">{summary.mastery_counted ? 'Засчитано как самостоятельная устная задача.' : `На освоение не влияет: ${summary.mastery_reason ?? 'нет надёжного доказательства'}.`}</p>
                </>
              ) : <p className="small">{summary.label ?? (summary.reason === 'UNSCORED_SCENARIO' ? 'Этот сценарий тренировочный и не оценивается.' : 'Итог не сформирован: слишком мало подтверждённых реплик или оценка воздержалась. Без штрафа.')}</p>}
              <div className="row mt8"><Link className="btn small" href="/speaking">Новый разговор</Link><Link className="btn small outline" href="/errors">Мои ошибки</Link></div>
            </div>
          ) : null}
        </div>

        <aside className="stack">
          <div className="card cardpad">
            <div className="card-top"><div className="card-title"><Icon name="target" /> Прогресс разговора</div><span className="mono small">{view.progress.reached} / {view.progress.total}</span></div>
            <div className="progress-track"><div className="progress-fill" style={{ width: `${view.progress.total ? Math.round((view.progress.reached / view.progress.total) * 100) : 0}%` }} /></div>
            <div className="focus-list" style={{ marginTop: 12 }}>
              {view.progress.steps.map((st) => (
                <div key={st.node_id} className="focus-row" style={{ padding: '3px 8px' }}>
                  <span className={`check-dot ${st.reached && !st.current ? 'done' : st.current ? 'open' : ''}`} aria-hidden="true">{st.reached && !st.current ? <Icon name="check" /> : null}</span>
                  <span className="small" style={{ color: st.current ? 'var(--ink)' : 'var(--ink-2)', fontWeight: st.current ? 650 : 500 }}>{st.goal_ru ?? st.node_id}</span>
                </div>
              ))}
            </div>
          </div>
          {view.examples_el.length && view.status === 'ACTIVE' ? (
            <div className="card cardpad">
              <div className="card-title"><Icon name="chat" /> Полезные фразы</div>
              <p className="tiny quiet" style={{ marginTop: 4 }}>Один из возможных вариантов — не ключ. Отвечайте своими словами.</p>
              {view.examples_el.map((x) => <ExamplePhrase key={x} sessionId={view.session_id} text={x} canPlay={!!view.providers.tts} />)}
            </div>
          ) : null}
          <div className="card cardpad">
            <div className="card-title"><Icon name="info" /> Подсказки и разбор</div>
            <p className="small quiet">{hintsAllowed ? 'Подсказка, перевод и объяснение не меняют ход сцены: после них вы возвращаетесь к той же реплике. Помощь отмечается и не засчитывается как самостоятельная речь.' : 'Экзаменационная симуляция: подсказки отключены, оценка — после разговора.'}</p>
            {hintsAllowed ? <div className="row"><button className="btn small flat" type="button" onClick={() => askHelp('hint')}>Подсказка</button><button className="btn small outline" type="button" onClick={() => setHelpOpen(true)}>Разбор</button></div> : null}
          </div>
          <div className="card cardpad"><div className="card-title"><Icon name="shield" /> Распознавание и приватность</div><p className="small quiet">Распознавание: {view.providers.asr === 'local' ? 'локальный Whisper (разработка)' : view.providers.asr ?? 'не подключено'}. Уверенность распознавания — не оценка произношения. Запись голоса не хранится без вашего согласия (максимум 30 дней). Голос собеседника синтезирован.</p></div>
        </aside>
      </div>

      {helpOpen ? (
        <>
          <div className="overlay show" onClick={() => setHelpOpen(false)} />
          <aside className="drawer show" role="dialog" aria-modal="true" aria-label="Разбор трудности">
            <div className="row between"><b>Разбор трудности</b><button className="close" type="button" onClick={() => setHelpOpen(false)} aria-label="Закрыть"><Icon name="close" /></button></div>
            <p className="small quiet">Разговор на паузе в том же месте. Закройте панель, чтобы вернуться к прерванной реплике.</p>
            <div className="chip-row mt8">
              <button className="chip" type="button" onClick={() => askHelp('hint')}>Подсказка</button>
              <button className="chip" type="button" onClick={() => askHelp('translate')}>Что значит реплика?</button>
            </div>
            <div className="field">
              <label htmlFor="hq">Слово или фраза (по-гречески — объясню; по-русски — подскажу, как сказать)</label>
              <input id="hq" className="input" value={helpQ} onChange={(e) => setHelpQ(e.target.value)} />
              <div className="row"><button className="btn small outline" type="button" disabled={!helpQ.trim()} onClick={() => askHelp('explain')}>Что значит?</button><button className="btn small outline" type="button" disabled={!helpQ.trim()} onClick={() => askHelp('how_to_say')}>Как сказать?</button><button className="btn small outline" type="button" onClick={() => askHelp('why')}>Почему так?</button></div>
            </div>
            {helpRes ? (
              <div className="context-coach">
                <p className="small">{helpRes.answer_ru}</p>
                {helpRes.example_el ? <div className="greek-serif" lang="el" style={{ fontSize: 17 }}>{helpRes.example_el}</div> : null}
                {helpRes.note ? <p className="context-caption">{helpRes.note}</p> : null}
              </div>
            ) : null}
            <button className="btn mt16" type="button" onClick={() => setHelpOpen(false)}>Вернуться в разговор</button>
          </aside>
        </>
      ) : null}
    </>
  );
}

/** One authored example of the current step, voiced on demand with the persona voice (real audio). */
function ExamplePhrase({ sessionId, text, canPlay }: { sessionId: string; text: string; canPlay: boolean }) {
  const [state, setState] = useState<'idle' | 'loading' | 'playing' | 'error'>('idle');
  const audio = useRef<HTMLAudioElement | null>(null);
  async function play() {
    if (state === 'playing') { audio.current?.pause(); setState('idle'); return; }
    setState('loading');
    const r = await fetch('/api/speaking', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'say_example', session_id: sessionId, text, rate: 'normal' }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.url) { setState('error'); return; }
    const a = new Audio(j.url);
    audio.current = a;
    a.onended = () => setState('idle');
    await a.play().catch(() => setState('error'));
    setState('playing');
  }
  return (
    <div className="real-line" style={{ padding: '6px 0' }}>
      {canPlay ? <button type="button" className={`sound ${state === 'error' ? 'disabled' : ''}`} onClick={play} aria-label={`Послушать: ${text}`}><Icon name={state === 'playing' ? 'pause' : state === 'loading' ? 'clock' : 'play'} size={14} /></button> : null}
      <strong lang="el" className="display" style={{ fontSize: 15.5, fontWeight: 500 }}>{text}</strong>
    </div>
  );
}
