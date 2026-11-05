'use client';
import { animate, motion, useInView, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

/**
 * Number that animates only when the underlying data really changes (e.g. a new confirmed answer
 * arrives through Realtime): prev → new with a brief highlight. The first render shows the real value.
 */
export function AnimatedNumber({ value, format = (n: number) => String(Math.round(n)), duration = 0.8, className }: { value: number; format?: (n: number) => string; duration?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(value);
  const reduced = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    const from = prev.current;
    prev.current = value;
    if (!el || from === value) return;
    if (reduced || document.body.classList.contains('no-motion')) { el.textContent = format(value); return; }
    el.classList.remove('num-changed');
    void el.offsetWidth;
    el.classList.add('num-changed');
    const ctl = animate(from, value, { duration, ease: [0.16, 1, 0.3, 1], onUpdate: (v) => { el.textContent = format(v); } });
    return () => ctl.stop();
  }, [value, reduced, duration, format]);
  return <span ref={ref} className={className}>{format(value)}</span>;
}

/** Progress ring (SVG). The stroke animates to the real percentage after it scrolls into view. */
export function ProgressRing({ value, size = 92, stroke = 9, label, sub, tone = 'accent' }: { value: number; size?: number; stroke?: number; label?: React.ReactNode; sub?: string; tone?: 'accent' | 'olive' | 'sea' }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true });
  const pct = Math.max(0, Math.min(100, value));
  const color = tone === 'olive' ? 'var(--olive)' : tone === 'sea' ? 'var(--sea)' : 'var(--accent)';
  return (
    <div className="ring" ref={ref} style={{ width: size, height: size }} role="img" aria-label={`${Math.round(pct)}%${sub ? ` ${sub}` : ''}`}>
      <svg width={size} height={size}>
        <circle className="ring-track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none" />
        <circle className="ring-value" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none" style={{ stroke: color }} strokeDasharray={c} strokeDashoffset={inView ? c * (1 - pct / 100) : c} />
      </svg>
      <div className="ring-label" aria-hidden="true"><div>{label ?? `${Math.round(pct)}%`}{sub ? <small>{sub}</small> : null}</div></div>
    </div>
  );
}

/** Staggered reveal for client-rendered groups (cards, rows). Server pages use the CSS .stagger class. */
export function Reveal({ children, className, delay = 0, as = 'div' }: { children: React.ReactNode; className?: string; delay?: number; as?: 'div' | 'section' | 'ul' }) {
  const Comp = as === 'section' ? motion.section : as === 'ul' ? motion.ul : motion.div;
  return (
    <Comp className={className} initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05, delayChildren: delay } } }}>
      {children}
    </Comp>
  );
}

export const revealItem = {
  hidden: { opacity: 0, y: 14, filter: 'blur(6px)' },
  show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.42, ease: [0.16, 1, 0.3, 1] as const } },
};

/** Keeps a short "just changed" flag so a card can acknowledge a real data update (e.g. after Realtime). */
export function useChangedFlag(value: unknown, ms = 1200): boolean {
  const [changed, setChanged] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setChanged(true);
    const t = setTimeout(() => setChanged(false), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return changed;
}
