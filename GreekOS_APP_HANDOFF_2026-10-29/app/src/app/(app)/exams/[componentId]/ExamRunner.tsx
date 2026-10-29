'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ItemDTO, StimulusDTO } from '@/lib/content/dto';
import { ExamAudio } from './ExamAudio';
import type { StoredResults } from '@/lib/exams/service';
import { formatClock, type ExamAnswer, type ExamAnswers } from '@/lib/exams/core';
import { Icon } from '@/components/Icon';
import { ExamItemInput } from '../ExamItemInput';
import { ExamResults } from '../ExamResults';

interface AttemptState {
  attempt_id: string;
  mode: 'simulation' | 'practice';
  status: 'IN_PROGRESS' | 'SUBMITTED' | 'EXPIRED' | 'ABANDONED';
  server_now: string;
  started_at: string;
  expires_at: string | null;
  autosave_seq: number;
  answers: ExamAnswers;
  results: StoredResults | null;
  audio_plays?: Record<string, number>;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'offline' | 'error';

function uuid() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const backupKey = (id: string) => `greekos-exam-${id}`;
function readBackup(id: string): { seq: number; answers: ExamAnswers } | null {
  try { const raw = localStorage.getItem(backupKey(id)); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function writeBackup(id: string, seq: number, answers: ExamAnswers) {
  try { localStorage.setItem(backupKey(id), JSON.stringify({ seq, answers })); } catch { /* storage unavailable: server autosave still applies */ }
}
function clearBackup(id: string) {
  try { localStorage.removeItem(backupKey(id)); } catch { /* ignore */ }
}

export function ExamRunner(props: {
  componentId: string;
  displayId: string;
  kindRu: string;
  items: ItemDTO[];
  texts: Array<StimulusDTO & { text_id: string }>;
  columns: string[];
  durationMinutes: number | null;
  initial: AttemptState | null;
}) {
  const router = useRouter();
  const [state, setState] = useState<AttemptState | null>(props.initial);
  const [answers, setAnswers] = useState<ExamAnswers>(props.initial?.answers ?? {});
  const [mode, setMode] = useState<'simulation' | 'practice'>(props.durationMinutes ? 'simulation' : 'practice');
  const [save, setSave] = useState<SaveState>('idle');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [offset, setOffset] = useState(() => (props.initial ? Date.parse(props.initial.server_now) - Date.now() : 0)); // server - client clock (ms)
  const [now, setNow] = useState<number | null>(null); // set after mount to avoid hydration mismatch
  const restoredRef = useRef(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seqRef = useRef(props.initial?.autosave_seq ?? 0);
  const dirtyRef = useRef(false);
  const answersRef = useRef<ExamAnswers>(answers);
  const startKey = useRef(uuid());
  const submittingRef = useRef(false);
  const sharedIds = useMemo(() => props.texts.map((t) => t.text_id), [props.texts]);
  const running = state?.status === 'IN_PROGRESS';

  const adopt = useCallback((s: AttemptState) => {
    setOffset(Date.parse(s.server_now) - Date.now());
    setState(s);
    seqRef.current = Math.max(seqRef.current, s.autosave_seq);
    if (s.status === 'SUBMITTED') clearBackup(s.attempt_id);
  }, []);

  const refresh = useCallback(async () => {
    if (!state) return;
    try {
      const r = await fetch(`/api/exams/attempts/${state.attempt_id}`, { cache: 'no-store' });
      if (r.ok) adopt(await r.json());
    } catch { setSave('offline'); }
  }, [state, adopt]);

  const doSave = useCallback(async () => {
    if (!state || state.status !== 'IN_PROGRESS' || !dirtyRef.current) return;
    const seq = seqRef.current + 1;
    const snapshot = answersRef.current;
    writeBackup(state.attempt_id, seq, snapshot);
    setSave('saving');
    try {
      const r = await fetch('/api/exams/autosave', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ attempt_id: state.attempt_id, seq, answers: snapshot }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        seqRef.current = j.autosave_seq;
        if (answersRef.current === snapshot) dirtyRef.current = false;
        setSave('saved');
        setSavedAt(j.saved_at);
        if (j.server_now) setOffset(Date.parse(j.server_now) - Date.now());
        return;
      }
      if (j.error === 'STALE') { await refresh(); return; }
      if (j.error === 'EXPIRED' || j.error === 'SUBMITTED') { await refresh(); return; }
      setSave('error');
      setError(j.message ?? 'Не удалось сохранить.');
    } catch {
      setSave('offline');
    }
  }, [state, refresh]);

  // Debounced save after change + periodic 10 s save while dirty.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => { void doSave(); }, 10_000);
    return () => clearInterval(t);
  }, [running, doSave]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const onOnline = () => { void refresh().then(() => doSave()); };
    const onOffline = () => setSave('offline');
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [refresh, doSave]);

  // 1 s ticker; on the first tick restore a newer local backup (e.g. after a lost connection).
  useEffect(() => {
    const tick = () => {
      setNow(Date.now());
      const init = props.initial;
      if (restoredRef.current || !init || init.status !== 'IN_PROGRESS') return;
      restoredRef.current = true;
      const b = readBackup(init.attempt_id);
      if (b && b.seq > init.autosave_seq) {
        setAnswers(b.answers);
        answersRef.current = b.answers;
        dirtyRef.current = true;
      }
    };
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [props.initial]);

  const remaining = state?.expires_at && now !== null ? Math.max(0, Date.parse(state.expires_at) - (now + offset)) : null;

  const submit = useCallback(async () => {
    if (!state || submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/exams/submit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ attempt_id: state.attempt_id, seq: seqRef.current + 1, answers: answersRef.current }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(j.message ?? 'Не удалось отправить. Ответы сохранены — попробуйте ещё раз.'); submittingRef.current = false; return; }
      adopt(j);
      setConfirm(false);
      router.refresh();
    } catch {
      setError('Нет связи. Ответы сохранены в браузере и на сервере (последнее автосохранение). Повторите отправку.');
      submittingRef.current = false;
    } finally {
      setBusy(false);
    }
  }, [state, adopt, router]);

  // Time is up: submit what the server has (it ignores late answers beyond the grace window).
  useEffect(() => {
    if (running && remaining === 0) void submit();
    if (state?.status === 'EXPIRED' && !submittingRef.current) void submit();
  }, [running, remaining, state?.status, submit]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/exams/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ component_id: props.componentId, mode, idempotency_key: startKey.current }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(j.message ?? 'Не удалось начать.'); return; }
      adopt(j);
      setAnswers(j.answers ?? {});
      answersRef.current = j.answers ?? {};
    } catch {
      setError('Нет связи с сервером. Попробуйте снова — повторный запрос не создаст вторую попытку.');
    } finally {
      setBusy(false);
    }
  }

  function change(itemId: string, v: ExamAnswer) {
    const next = { ...answersRef.current, [itemId]: v };
    answersRef.current = next;
    dirtyRef.current = true;
    setAnswers(next);
    if (state) writeBackup(state.attempt_id, seqRef.current + 1, next);
  }

  // Debounce: save 2 s after the last change.
  useEffect(() => {
    if (!running || !dirtyRef.current) return;
    const t = setTimeout(() => { void doSave(); }, 2000);
    return () => clearTimeout(t);
  }, [answers, running, doSave]);

  const listeningAssets = useMemo(() => [...new Set(props.items.flatMap((i) => (i.audio?.status === 'available' ? [i.audio.asset_id] : [])))], [props.items]);
  const answeredCount = props.items.filter((i) => { const a = answers[i.item_id]; return a && (a.choice !== undefined || !!a.text?.trim()); }).length;
  const prompts = useMemo(() => Object.fromEntries(props.items.map((i) => [i.item_id, i.prompt])), [props.items]);
  const options = useMemo(() => Object.fromEntries(props.items.map((i) => [i.item_id, Object.fromEntries(i.options.map((o) => [o.key, o.label]))])), [props.items]);

  if (state?.status === 'SUBMITTED') {
    return state.results ? (
      <div className="stack">
        <div className="row between"><b>Попытка сдана{state.mode === 'simulation' ? ' (симуляция с таймером)' : ' (практика без таймера)'}</b><button className="btn outline" type="button" onClick={() => { setState(null); setAnswers({}); answersRef.current = {}; seqRef.current = 0; startKey.current = uuid(); submittingRef.current = false; }}>Пройти ещё раз</button></div>
        <ExamResults results={state.results} prompts={prompts} options={options} />
      </div>
    ) : <div className="card empty" aria-busy="true"><strong>Идёт подсчёт</strong>Результаты появятся через несколько секунд. <button className="text-link" type="button" onClick={() => void refresh()}>Обновить</button></div>;
  }

  if (!state) {
    return (
      <div className="card placement-panel">
        <div className="eyebrow">{props.kindRu} · {props.displayId}</div>
        <h2 className="placement-title">Как будете проходить?</h2>
        <div className="placement-choices" role="radiogroup" aria-label="Режим">
          <button type="button" role="radio" aria-checked={mode === 'simulation'} disabled={!props.durationMinutes} className={`placement-choice ${mode === 'simulation' ? 'selected' : ''}`} onClick={() => setMode('simulation')}>
            <span><b style={{ display: 'block' }}>Симуляция с таймером</b><small className="quiet">{props.durationMinutes ? `${props.durationMinutes} мин по серверным часам; без подсказок; ответы видны только после отправки.` : 'Для компонента не задано время — недоступно.'}</small></span>
          </button>
          <button type="button" role="radio" aria-checked={mode === 'practice'} className={`placement-choice ${mode === 'practice' ? 'selected' : ''}`} onClick={() => setMode('practice')}>
            <span><b style={{ display: 'block' }}>Практика без таймера</b><small className="quiet">Можно прерываться; автосохранение то же.</small></span>
          </button>
        </div>
        {error ? <p className="error-text" role="alert">{error}</p> : null}
        <div className="placement-footer"><span className="quiet">{props.items.length} заданий. Прогресс сохраняется на сервере, вкладку можно закрыть.</span><button className="btn" type="button" onClick={start} disabled={busy}>{busy ? 'Начинаю…' : 'Начать'}</button></div>
      </div>
    );
  }

  return (
    <div>
      <div className="exam-runbar" role="region" aria-label="Состояние попытки">
        <div className="row">
          {state.expires_at ? <span className={`timer ${remaining !== null && remaining < 5 * 60_000 ? 'low' : ''}`} role="timer" aria-live={remaining !== null && remaining < 60_000 ? 'assertive' : 'off'}>{remaining === null ? '--:--' : formatClock(remaining)}</span> : <span className="tag gray">без таймера</span>}
          <span className="small quiet">Отвечено {answeredCount} из {props.items.length}</span>
        </div>
        <div className="row">
          <span className={`exam-save ${save === 'error' || save === 'offline' ? 'err' : ''}`} aria-live="polite">
            {save === 'saving' ? 'Сохраняю…' : save === 'saved' ? `Сохранено ${savedAt ? new Date(savedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''}` : save === 'offline' ? 'Нет связи — ответы хранятся в браузере' : save === 'error' ? 'Ошибка сохранения' : 'Автосохранение включено'}
          </span>
          <button className="btn dark" type="button" onClick={() => setConfirm(true)} disabled={busy}>Сдать</button>
        </div>
      </div>
      {save === 'offline' ? <div className="banner warn" role="status"><Icon name="alert" /><span>Соединение прервалось. Ответы сохранены в этом браузере и будут отправлены автоматически; время отсчитывается сервером.</span></div> : null}
      {confirm ? (
        <div className="banner info" role="alertdialog" aria-label="Подтверждение отправки">
          <span style={{ flex: 1 }}><strong>Сдать попытку?</strong> После отправки ответы изменить нельзя.{props.items.length - answeredCount ? ` Без ответа: ${props.items.length - answeredCount}.` : ''}</span>
          <button className="btn" type="button" onClick={() => void submit()} disabled={busy}>{busy ? 'Отправляю…' : 'Сдать'}</button>
          <button className="btn outline" type="button" onClick={() => setConfirm(false)} disabled={busy}>Вернуться</button>
        </div>
      ) : null}
      {error ? <p className="error-text" role="alert">{error}</p> : null}
      {props.texts.length ? (
        <div className="exam-texts">
          {props.texts.map((t) => (
            <div className="card cardpad" key={t.text_id}>
              <div className="tiny muted">Текст {t.text_id.replace('KEG-B2-', '')}</div>
              <div className="stimulus" lang="el" tabIndex={0}>
                {t.title ? <b>{t.title}{'\n'}</b> : null}
                {t.segments?.length ? t.segments.map((s) => `(${s.label}) ${s.text}`).join('\n\n') : t.text}
                {t.example ? <div className="bank"><span>Пример ({String(t.example.gap)}): {t.example.filled}</span></div> : null}
                {t.phrase_bank ? <div className="bank">{(Array.isArray(t.phrase_bank) ? t.phrase_bank.map((p, i) => [String(i + 1), p]) : Object.entries(t.phrase_bank)).map(([k, p]) => <span key={k}><b>{k}</b> — {p}</span>)}</div> : null}
                {t.word_bank?.length ? <div className="bank"><span>Банк: {t.word_bank.join(' · ')}</span></div> : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {listeningAssets.length ? (
        <div className="exam-texts">
          {listeningAssets.map((assetId, k) => (
            <ExamAudio key={assetId} attemptId={state.attempt_id} assetId={assetId} label={`Запись ${k + 1}`} mode={state.mode} initialUsed={(state.audio_plays ?? {})[assetId] ?? 0} disabled={!running} />
          ))}
        </div>
      ) : null}
      <div className="exam-items mt16">
        {props.items.map((it, i) => (
          <ExamItemInput key={it.item_id} item={it} index={i} value={answers[it.item_id]} onChange={(v) => change(it.item_id, v)} disabled={!running || busy} sharedTextIds={sharedIds} columns={props.columns} />
        ))}
      </div>
      <div className="row mt16"><button className="btn dark" type="button" onClick={() => setConfirm(true)} disabled={busy}>Сдать попытку</button></div>
    </div>
  );
}
