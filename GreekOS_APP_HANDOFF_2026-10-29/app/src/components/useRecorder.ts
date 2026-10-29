'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

export type RecorderState = 'idle' | 'requesting' | 'denied' | 'recording' | 'processing' | 'unsupported' | 'error';

function encodeWav16k(buffer: AudioBuffer): Blob {
  const targetRate = 16000;
  const ch = buffer.numberOfChannels;
  const len = buffer.length;
  const mono = new Float32Array(len);
  for (let c = 0; c < ch; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < len; i++) mono[i] += d[i] / ch;
  }
  const ratio = buffer.sampleRate / targetRate;
  const outLen = Math.max(1, Math.floor(len / ratio));
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    // Box-filter average to avoid aliasing when downsampling.
    const start = Math.floor(i * ratio);
    const end = Math.min(len, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += mono[j];
    const v = Math.max(-1, Math.min(1, sum / Math.max(1, end - start)));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  const ab = new ArrayBuffer(44 + out.length * 2);
  const dv = new DataView(ab);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); dv.setUint32(4, 36 + out.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, targetRate, true);
  dv.setUint32(28, targetRate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, out.length * 2, true);
  new Int16Array(ab, 44).set(out);
  return new Blob([ab], { type: 'audio/wav' });
}

/**
 * Push-to-talk recorder: microphone → MediaRecorder → decoded → 16 kHz mono WAV in the browser.
 * The level meter follows real RMS (no decorative animation). Nothing is uploaded here.
 */
export function useRecorder(maxSeconds = 90) {
  const [state, setState] = useState<RecorderState>('idle');
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const media = useRef<MediaStream | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const ctx = useRef<AudioContext | null>(null);
  const raf = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const resolver = useRef<((b: Blob | null) => void) | null>(null);

  const cleanup = useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current);
    if (timer.current) clearInterval(timer.current);
    media.current?.getTracks().forEach((t) => t.stop());
    media.current = null;
    setLevel(0);
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const start = useCallback(async () => {
    if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setState('unsupported'); return false; }
    setState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
      media.current = stream;
      ctx.current ??= new AudioContext();
      const src = ctx.current.createMediaStreamSource(stream);
      const analyser = ctx.current.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      const data = new Float32Array(analyser.fftSize);
      const tick = () => {
        analyser.getFloatTimeDomainData(data);
        let s = 0;
        for (const v of data) s += v * v;
        setLevel(Math.min(1, Math.sqrt(s / data.length) * 4));
        raf.current = requestAnimationFrame(tick);
      };
      tick();
      chunks.current = [];
      const r = new MediaRecorder(stream);
      rec.current = r;
      r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      r.onstop = async () => {
        cleanup();
        setState('processing');
        try {
          const blob = new Blob(chunks.current, { type: r.mimeType || 'audio/webm' });
          const decoded = await ctx.current!.decodeAudioData(await blob.arrayBuffer());
          const wav = encodeWav16k(decoded);
          setState('idle');
          resolver.current?.(wav);
        } catch {
          setState('error');
          resolver.current?.(null);
        }
      };
      r.start(250);
      setElapsed(0);
      const t0 = Date.now();
      timer.current = setInterval(() => {
        const sec = Math.floor((Date.now() - t0) / 1000);
        setElapsed(sec);
        if (sec >= maxSeconds && rec.current?.state === 'recording') rec.current.stop();
      }, 250);
      setState('recording');
      return true;
    } catch (e) {
      cleanup();
      setState((e as DOMException)?.name === 'NotAllowedError' || (e as DOMException)?.name === 'SecurityError' ? 'denied' : 'error');
      return false;
    }
  }, [cleanup, maxSeconds]);

  /** Stops and resolves with a 16 kHz WAV blob (or null on failure). */
  const stop = useCallback(() => new Promise<Blob | null>((resolve) => {
    resolver.current = resolve;
    if (rec.current?.state === 'recording') rec.current.stop();
    else resolve(null);
  }), []);

  const cancel = useCallback(() => {
    resolver.current = null;
    if (rec.current?.state === 'recording') { rec.current.onstop = () => cleanup(); rec.current.stop(); }
    cleanup();
    setState('idle');
  }, [cleanup]);

  return { state, level, elapsed, start, stop, cancel };
}
