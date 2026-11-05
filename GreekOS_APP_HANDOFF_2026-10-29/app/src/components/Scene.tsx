'use client';
import { useEffect, useRef } from 'react';

/**
 * Atmospheric layer behind every surface: original GreekOS illustration (Thessaloniki waterfront,
 * pre-blurred raster, so no runtime blur cost) + warm tint + grain. A restrained pointer parallax
 * (≤ 10 px, rAF-throttled, transform only) runs on fine pointers when motion is allowed.
 */
export function Scene() {
  const img = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = img.current;
    if (!el) return;
    const fine = window.matchMedia('(pointer: fine)').matches;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (!fine) return;
    let frame = 0;
    let tx = 0;
    let ty = 0;
    const onMove = (e: PointerEvent) => {
      if (reduced.matches || document.body.classList.contains('no-motion')) return;
      tx = (e.clientX / window.innerWidth - 0.5) * -10;
      ty = (e.clientY / window.innerHeight - 0.5) * -6;
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        el.style.setProperty('--px', `${tx.toFixed(1)}px`);
        el.style.setProperty('--py', `${ty.toFixed(1)}px`);
      });
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => { window.removeEventListener('pointermove', onMove); if (frame) cancelAnimationFrame(frame); };
  }, []);
  return (
    <div className="scene" aria-hidden="true">
      <div className="scene-img" ref={img} />
      <div className="scene-tint" />
      <div className="scene-grain" />
    </div>
  );
}
