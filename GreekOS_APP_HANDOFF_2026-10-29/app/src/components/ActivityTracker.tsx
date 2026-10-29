'use client';
import { useEffect, useRef } from 'react';

/**
 * Counts only active seconds: tab visible AND an interaction within the last 60 s.
 * Sends a capped heartbeat each minute; idle screens never inflate study time.
 */
export function ActivityTracker() {
  const lastInput = useRef(0);
  const acc = useRef(0);
  useEffect(() => {
    const mark = () => { lastInput.current = Date.now(); };
    mark();
    const events = ['pointerdown', 'keydown', 'touchstart', 'scroll'];
    events.forEach((e) => window.addEventListener(e, mark, { passive: true }));
    const tick = setInterval(() => {
      if (document.visibilityState === 'visible' && Date.now() - lastInput.current < 60_000) acc.current += 5;
    }, 5000);
    const flush = setInterval(() => {
      const seconds = Math.min(120, acc.current);
      if (seconds < 5) return;
      acc.current = 0;
      fetch('/api/activity', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ seconds, beat_id: crypto.randomUUID() }), keepalive: true }).catch(() => { acc.current += seconds; });
    }, 60_000);
    return () => { events.forEach((e) => window.removeEventListener(e, mark)); clearInterval(tick); clearInterval(flush); };
  }, []);
  return null;
}
