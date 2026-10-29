'use client';
import { useState } from 'react';
import { useRecorder } from './useRecorder';
import { Icon } from './Icon';

export interface Transcript { text: string; confidence: number | null; status: string; provider: string; synthetic: boolean; edited: boolean }

/**
 * Push-to-talk answer with explicit transcript confirmation. Low-confidence recognition asks to
 * repeat or confirm; it is never treated as a learner error.
 */
export function VoiceAnswer(props: { disabled?: boolean; allowEdit?: boolean; sessionId?: string; onConfirmed: (text: string, t: Transcript) => void; onDenied?: () => void }) {
  const rec = useRecorder(90);
  const [t, setT] = useState<Transcript | null>(null);
  const [edit, setEdit] = useState('');
  const [editing, setEditing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setErr(null);
    if (rec.state === 'recording') {
      const wav = await rec.stop();
      if (!wav) return setErr('Не удалось обработать запись. Попробуйте ещё раз.');
      setBusy(true);
      try {
        const r = await fetch(`/api/speech/transcribe${props.sessionId ? `?session_id=${props.sessionId}` : ''}`, { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: wav });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { setErr(j.message ?? 'Распознавание не удалось.'); return; }
        setT({ text: j.text, confidence: j.confidence, status: j.status, provider: j.provider, synthetic: j.synthetic, edited: false });
        setEdit(j.text);
      } catch {
        setErr('Соединение прервалось. Запишите фразу ещё раз.');
      } finally { setBusy(false); }
      return;
    }
    setT(null);
    const ok = await rec.start();
    if (!ok) props.onDenied?.();
  }

  const bars = Array.from({ length: 13 }, (_, i) => Math.max(4, Math.round(rec.level * 40 * (0.55 + 0.45 * Math.abs(Math.sin(i * 1.3))))));

  return (
    <div className="mt16">
      <div className="level-meter" aria-hidden="true">{bars.map((h, i) => <span key={i} style={{ height: rec.state === 'recording' ? h : 4 }} />)}</div>
      <div className="voice-controls">
        <button type="button" className={`mic-btn ${rec.state === 'recording' ? 'recording' : ''}`} onClick={toggle} disabled={props.disabled || busy || rec.state === 'processing' || rec.state === 'requesting'} aria-label={rec.state === 'recording' ? 'Остановить запись' : 'Начать запись'} aria-pressed={rec.state === 'recording'}>
          <Icon name={rec.state === 'recording' ? 'pause' : 'mic'} />
        </button>
      </div>
      <p className="voice-state" role="status" aria-live="polite">
        {rec.state === 'recording' ? `Слушаю… ${rec.elapsed} с — нажмите ещё раз, чтобы закончить` : rec.state === 'requesting' ? 'Запрашиваю микрофон…' : rec.state === 'processing' || busy ? 'Распознаю…' : rec.state === 'denied' ? 'Нет доступа к микрофону. Разрешите его в настройках браузера.' : rec.state === 'unsupported' ? 'Браузер не поддерживает запись.' : 'Нажмите и говорите по-гречески'}
      </p>
      {t ? (
        <div className={`verdict ${t.status === 'CONFIDENT' ? 'variant' : 'pending'}`}>
          {t.status === 'EMPTY' ? <b>Речь не распознана. Попробуйте ещё раз, ближе к микрофону.</b> : (
            <>
              <b>{t.status === 'CONFIDENT' ? 'Распознано' : 'Не уверен, что расслышал — проверьте'}</b>
              {editing ? <textarea className="input greek-input" lang="el" value={edit} onChange={(e) => setEdit(e.target.value)} aria-label="Исправление распознавания" /> : <span lang="el" className="greek-serif" style={{ fontSize: 17 }}>{t.text}</span>}
              <span className="tiny">{t.synthetic ? 'Синтетический тестовый транспорт — не настоящее распознавание.' : `Распознавание: ${t.provider}${t.confidence !== null ? `, уверенность провайдера ${Math.round(t.confidence * 100)}%` : ''}. Текст распознавания не доказывает произношение.`}</span>
              <div className="row mt8">
                <button className="btn" type="button" disabled={props.disabled} onClick={() => props.onConfirmed(editing ? edit : t.text, { ...t, text: editing ? edit : t.text, edited: editing && edit !== t.text })}>Да, отправить</button>
                <button className="btn outline" type="button" onClick={() => { setT(null); setEditing(false); }}>Записать заново</button>
                {props.allowEdit !== false && !editing ? <button className="text-link" type="button" onClick={() => setEditing(true)}>Исправить распознавание</button> : null}
              </div>
            </>
          )}
        </div>
      ) : null}
      {err ? <p className="error-text" role="alert">{err}</p> : null}
    </div>
  );
}
