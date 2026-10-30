'use client';
import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

type State = 'idle' | 'loading' | 'playing' | 'error';

/**
 * "Послушать": plays real synthesized audio of a lesson phrase (screened by ASR round-trip on the
 * server). The ring shows the actual playback position — nothing animates without sound.
 */
export function SayButton({ unitId, text, small }: { unitId: string; text: string; small?: boolean }) {
  const [state, setState] = useState<State>('idle');
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [played, setPlayed] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const cache = useRef<Record<string, string>>({});
  useEffect(() => () => { audio.current?.pause(); }, []);

  async function play(speed: 'normal' | 'slow') {
    if (state === 'playing') { audio.current?.pause(); setState('idle'); return; }
    setErr(null);
    setState('loading');
    try {
      let url = cache.current[speed];
      if (!url) {
        const r = await fetch('/api/speech/say', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ unit_id: unitId, text, speed }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.message ?? 'Озвучка недоступна');
        url = j.url as string;
        cache.current[speed] = url;
      }
      const a = new Audio(url);
      audio.current = a;
      a.ontimeupdate = () => setProgress(a.duration ? a.currentTime / a.duration : 0);
      a.onended = () => { setState('idle'); setProgress(0); };
      a.onerror = () => { setState('error'); setErr('Файл не воспроизводится'); };
      await a.play();
      setState('playing');
      setPlayed(true);
    } catch (e) {
      setState('error');
      setErr((e as Error).message);
    }
  }

  const r = small ? 13 : 16;
  const c = 2 * Math.PI * r;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <button type="button" className={`sound ${state === 'error' ? 'disabled' : ''}`} style={small ? { width: 30, height: 30 } : undefined} onClick={() => play('normal')}
        aria-label={state === 'playing' ? `Остановить: ${text}` : `Послушать: ${text}`} title={err ?? 'Послушать (синтезированный голос)'} aria-busy={state === 'loading'}>
        <svg width={r * 2 + 4} height={r * 2 + 4} style={{ position: 'absolute', pointerEvents: 'none', transform: 'rotate(-90deg)' }} aria-hidden="true">
          {state === 'playing' ? <circle cx={r + 2} cy={r + 2} r={r} fill="none" stroke="var(--accent)" strokeWidth="2" strokeDasharray={c} strokeDashoffset={c * (1 - progress)} /> : null}
        </svg>
        <Icon name={state === 'playing' ? 'pause' : state === 'loading' ? 'clock' : state === 'error' ? 'alert' : 'play'} size={small ? 13 : 15} />
      </button>
      {!small && played && state !== 'loading' ? <button type="button" className="text-link tiny" style={{ padding: 2 }} onClick={() => play('slow')} aria-label={`Медленнее: ${text}`} title="Медленнее">0.8×</button> : null}
      {err ? <span className="sr-only" role="status">{err}</span> : null}
    </span>
  );
}
