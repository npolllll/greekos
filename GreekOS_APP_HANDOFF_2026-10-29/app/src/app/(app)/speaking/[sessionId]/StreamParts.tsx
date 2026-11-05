'use client';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import type { PendingConfirm } from '@/components/useVoiceStream';

const BARS = 24;

/**
 * Voice indicator driven only by the measured audio level (mic while listening, synthesized
 * output while speaking) — no decorative loop. With reduced motion it updates 4×/s, no scaling.
 */
export function LevelOrb({ level, speaking, active }: { level: { current: number }; speaking: boolean; active: boolean }) {
  const orb = useRef<HTMLDivElement>(null);
  const bars = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const hist = new Array<number>(BARS).fill(0);
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < (reduce ? 250 : 50)) return;
      last = t;
      const l = active ? level.current : 0;
      hist.shift();
      hist.push(l);
      orb.current?.style.setProperty('--lvl', l.toFixed(3));
      const el = bars.current;
      if (el) for (let i = 0; i < BARS; i++) (el.children[i] as HTMLElement).style.height = `${Math.max(2, Math.round(hist[i] * 30))}px`;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [level, active]);
  return (
    <>
      <div ref={orb} className={`voice-orb live ${speaking ? 'out' : ''}`} aria-hidden="true"><Icon name={speaking ? 'volume' : 'mic'} /></div>
      <div ref={bars} className="level-bars" aria-hidden="true">{Array.from({ length: BARS }, (_, i) => <span key={i} />)}</div>
    </>
  );
}

const REASON_RU: Record<string, string> = {
  low_confidence: 'Распознавание неуверенное',
  no_confidence: 'Сервис распознавания не сообщил уверенность',
  possible_silence: 'Возможно, это был шум или тишина',
  not_greek: 'Похоже, фраза не на греческом',
  noisy_audio: 'Шумно или тихо — распознавание может ошибаться',
  synthetic: 'Синтетическое распознавание (тестовая среда)',
};

/** «Это вы сказали?» — uncertain recognition is confirmed, corrected or re-said; never penalised. */
export function ConfirmTranscript({ pending, onConfirm, onDiscard }: { pending: PendingConfirm; onConfirm: (text: string, edited: boolean) => void; onDiscard: () => void }) {
  const [text, setText] = useState(pending.text);
  const edited = text.trim() !== pending.text.trim();
  return (
    <div className="context-coach" role="group" aria-label="Проверка распознанного текста">
      <div className="context-eyebrow">ЭТО ВЫ СКАЗАЛИ?</div>
      <p className="tiny muted">{REASON_RU[pending.reason ?? ''] ?? 'Проверьте текст'} — без штрафа: подтвердите, исправьте или скажите заново.</p>
      <label className="sr-only" htmlFor={`confirm-${pending.utterance_id}`}>Распознанный текст</label>
      <textarea id={`confirm-${pending.utterance_id}`} className="greek-input" lang="el" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="row mt8">
        <button className="btn" type="button" disabled={!text.trim()} onClick={() => onConfirm(text.trim(), edited)}>{edited ? 'Отправить исправленное' : 'Да, отправить'}</button>
        <button className="btn outline" type="button" onClick={onDiscard}><Icon name="mic" /> Сказать заново</button>
      </div>
    </div>
  );
}
