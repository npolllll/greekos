'use client';
import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

/**
 * Plays a REAL audio asset (signed URL fetched on first play). Progress, time and state come from
 * the media element itself. Practice allows replay, seeking and 0.8×; exam mode is handled elsewhere.
 */
export function AudioPlayer({ assetId, devOnly, qa }: { assetId: string; devOnly?: boolean; qa?: 'verified' | 'needs_review' }) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'playing' | 'paused' | 'error'>('idle');
  const [t, setT] = useState(0);
  const [d, setD] = useState(0);
  const [slow, setSlow] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => () => ref.current?.pause(), []);
  useEffect(() => { if (ref.current) ref.current.playbackRate = slow ? 0.8 : 1; }, [slow]);

  async function ensureUrl(): Promise<string | null> {
    if (url) return url;
    const r = await fetch(`/api/media/audio/${assetId}`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.url) { setErr(j.message ?? 'Аудио недоступно'); setState('error'); return null; }
    setUrl(j.url);
    return j.url as string;
  }

  async function toggle() {
    const a = ref.current;
    if (!a) return;
    if (state === 'playing') { a.pause(); return; }
    setState('loading');
    const u = await ensureUrl();
    if (!u) return;
    if (a.src !== u) a.src = u;
    a.playbackRate = slow ? 0.8 : 1;
    try { await a.play(); } catch { setState('error'); setErr('Браузер не смог воспроизвести файл'); }
  }

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  return (
    <div className="audio-player" role="group" aria-label="Аудиозапись задания">
      <audio ref={ref} preload="none" onPlay={() => setState('playing')} onPause={() => setState((s) => (s === 'error' ? s : 'paused'))} onEnded={() => setState('paused')}
        onTimeUpdate={(e) => setT(e.currentTarget.currentTime)} onLoadedMetadata={(e) => setD(e.currentTarget.duration)} onError={() => { if (url) { setState('error'); setErr('Файл не воспроизводится'); } }} />
      <button type="button" className="play" onClick={toggle} aria-label={state === 'playing' ? 'Пауза' : 'Слушать'} disabled={state === 'loading'}>
        <Icon name={state === 'playing' ? 'pause' : state === 'loading' ? 'clock' : 'play'} size={18} />
      </button>
      <div className="audio-track">
        <div className="audio-bar" onClick={(e) => { const a = ref.current; if (!a || !d) return; const r = e.currentTarget.getBoundingClientRect(); a.currentTime = ((e.clientX - r.left) / r.width) * d; }}>
          <i style={{ width: `${d ? (t / d) * 100 : 0}%` }} />
        </div>
        <div className="audio-time"><span>{fmt(t)}</span><span>{d ? fmt(d) : '—:—'}</span></div>
        <div className="audio-badges">
          <span className="tag gray">синтезированный голос el-GR</span>
          {devOnly ? <span className="tag gold">локальная озвучка · не выпущена</span> : <span className="tag green">цифровая проверка пройдена</span>}
          {qa === 'needs_review' ? <span className="tag">авто-проверка не пройдена — нужен слушатель</span> : null}
          {err ? <span className="tag" role="alert">{err}</span> : null}
        </div>
      </div>
      <button type="button" className={`chip ${slow ? 'active' : ''}`} onClick={() => setSlow((s) => !s)} aria-pressed={slow} title="Медленнее (без изменения высоты голоса)">0.8×</button>
      <button type="button" className="icon-btn" style={{ width: 38, height: 38 }} onClick={() => { const a = ref.current; if (a) { a.currentTime = 0; void toggle(); } }} aria-label="Сначала"><Icon name="replay" size={16} /></button>
    </div>
  );
}
