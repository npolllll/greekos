'use client';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { EXAM_LISTENING_PLAYS } from '@/lib/exams/core';

/**
 * Exam listening player: no seek bar and no transcript; each play is requested from the server,
 * which counts it (simulation: the form's limit, practice: unlimited). Progress shows real time.
 */
export function ExamAudio({ attemptId, assetId, label, mode, initialUsed, disabled }: { attemptId: string; assetId: string; label: string; mode: 'simulation' | 'practice'; initialUsed: number; disabled: boolean }) {
  const [used, setUsed] = useState(initialUsed);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState<{ t: number; d: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => audio.current?.pause(), []);
  const left = mode === 'simulation' ? Math.max(0, EXAM_LISTENING_PLAYS - used) : null;

  async function play() {
    setErr(null);
    const r = await fetch(`/api/exams/attempts/${attemptId}/audio`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ asset_id: assetId }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(j.message ?? 'Аудио недоступно'); if (j.error === 'NO_MORE_PLAYS') setUsed(EXAM_LISTENING_PLAYS); return; }
    setUsed(j.plays_used);
    const a = new Audio(j.url);
    audio.current = a;
    a.ontimeupdate = () => setPos({ t: a.currentTime, d: a.duration || 0 });
    a.onended = () => { setPlaying(false); setPos(null); };
    a.onerror = () => { setPlaying(false); setErr('Не удалось воспроизвести запись.'); };
    setPlaying(true);
    await a.play().catch(() => { setPlaying(false); setErr('Браузер не дал воспроизвести звук — нажмите ещё раз.'); });
  }

  return (
    <div className="card cardpad exam-audio">
      <div className="row between">
        <b><Icon name="headphones" /> {label}</b>
        <span className="tag gray" aria-live="polite">{left === null ? `Прослушано: ${used} (практика, без ограничения)` : `Осталось прослушиваний: ${left} из ${EXAM_LISTENING_PLAYS}`}</span>
      </div>
      <div className="row mt8">
        <button className="btn" type="button" onClick={play} disabled={disabled || playing || left === 0}>{playing ? 'Воспроизводится…' : used ? 'Прослушать ещё раз' : 'Прослушать'}</button>
        {pos ? <progress max={pos.d || 1} value={pos.t} aria-label="Ход воспроизведения" style={{ flex: 1 }} /> : null}
      </div>
      {err ? <p className="error-text" role="alert">{err}</p> : null}
      <p className="tiny muted mt8">Синтезированный голос. Перемотки и транскрипта нет, как на экзамене{mode === 'simulation' ? '; каждое прослушивание учитывается сервером' : ''}.</p>
    </div>
  );
}
