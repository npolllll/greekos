'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { decodeAudioChunk, INPUT_SAMPLE_RATE, type ClientMessage, type ServerMessage, type Speed, type PersonaWire, type ConfirmReasonWire } from '@/lib/speaking/stream-protocol';

export type StreamStatus =
  | 'idle' | 'unsupported' | 'requesting_microphone' | 'permission_denied' | 'connecting'
  | 'listening' | 'speech' | 'transcribing' | 'confirming' | 'thinking' | 'speaking' | 'paused'
  | 'network_lost' | 'error';

export const STREAM_LABEL_RU: Record<StreamStatus, string> = {
  idle: 'Готово к началу', unsupported: 'Потоковый режим недоступен', requesting_microphone: 'Запрашиваю микрофон…',
  permission_denied: 'Нет доступа к микрофону', connecting: 'Подключение…', listening: 'Слушаю', speech: 'Слушаю — вы говорите',
  transcribing: 'Распознаю…', confirming: 'Это вы сказали?', thinking: 'Думаю…', speaking: 'Говорю', paused: 'Пауза',
  network_lost: 'Ошибка сети — переподключаюсь', error: 'Ошибка',
};

export interface PendingConfirm { utterance_id: string; text: string; reason: ConfirmReasonWire | null; confidence: number | null }

interface Scheduled { src: AudioBufferSourceNode; when: number; startMs: number; dur: number }

/** Automated browser tests feed a synthetic clip as the "microphone" and must label it so. */
function inputSource(): 'microphone' | 'synthetic_test_clip' {
  try { return localStorage.getItem('greekos.inputSource') === 'synthetic_test_clip' ? 'synthetic_test_clip' : 'microphone'; } catch { return 'microphone'; }
}

export function streamSupported(): boolean {
  return typeof window !== 'undefined' && 'WebSocket' in window && 'AudioContext' in window && 'AudioWorkletNode' in window && !!navigator.mediaDevices?.getUserMedia;
}

/**
 * Streaming-duplex client for the voice gateway: mic → AudioWorklet (16 kHz PCM16) → WebSocket;
 * synthesized speech is scheduled chunk by chunk as it arrives. Barge-in stops playback at once
 * and reports how much was actually heard. Levels come from the real signals (mic and output).
 */
export function useVoiceStream(opts: {
  sessionId: string;
  initialSpeed: Speed;
  onView: (view: unknown) => void;
  onTurnMeta?: (m: { engine: string | null; hint_ru: string | null }) => void;
  onAssistantText?: (turnId: string, text: string) => void;
}) {
  const [status, setStatus] = useState<StreamStatus>('idle');
  const [partial, setPartial] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [persona, setPersona] = useState<PersonaWire | null>(null);
  const [asrInfo, setAsrInfo] = useState<{ provider: string; partials: boolean } | null>(null);
  const [speakingTurn, setSpeakingTurn] = useState<string | null>(null);
  const [speed, setSpeedState] = useState<Speed>(opts.initialSpeed);
  const [autoBargeIn, setAutoBargeIn] = useState(true);

  const ws = useRef<WebSocket | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const mic = useRef<MediaStream | null>(null);
  const node = useRef<AudioWorkletNode | null>(null);
  const outGain = useRef<GainNode | null>(null);
  const outAnalyser = useRef<AnalyserNode | null>(null);
  const micLevel = useRef(0);
  const outLevel = useRef(0);
  const noiseFloor = useRef(-60);
  const loudSince = useRef<number | null>(null);
  const authed = useRef(false);
  const paused = useRef(false);
  const stopping = useRef(false);
  const retries = useRef(0);
  const micGrantedAt = useRef(0);
  const firstReady = useRef(true);
  const workletCtx = useRef<AudioContext | null>(null);
  const reconnect = useRef<() => void>(() => undefined);
  const heardTurns = useRef<Set<string>>(new Set());
  const cancelled = useRef<Set<string>>(new Set());
  const play = useRef<{ turnId: string | null; nextTime: number; items: Scheduled[]; startedSent: boolean; ended: boolean; endTimer: ReturnType<typeof setTimeout> | null }>({ turnId: null, nextTime: 0, items: [], startedSent: false, ended: false, endTimer: null });
  const optsRef = useRef(opts);
  useEffect(() => { optsRef.current = opts; });
  const speedRef = useRef(speed);
  useEffect(() => { speedRef.current = speed; }, [speed]);
  const autoRef = useRef(autoBargeIn);
  useEffect(() => { autoRef.current = autoBargeIn; }, [autoBargeIn]);

  const send = useCallback((m: ClientMessage) => {
    if (ws.current?.readyState === WebSocket.OPEN && authed.current) ws.current.send(JSON.stringify(m));
  }, []);

  const heardMs = useCallback(() => {
    const p = play.current;
    const now = ctx.current?.currentTime ?? 0;
    let heard = 0;
    for (const it of p.items) if (it.when <= now) heard = it.startMs + Math.min(it.dur, now - it.when) * 1000;
    return Math.max(0, Math.round(heard));
  }, []);

  const stopPlayback = useCallback(() => {
    const p = play.current;
    for (const it of p.items) { try { it.src.stop(); } catch { /* already stopped */ } }
    if (p.endTimer) clearTimeout(p.endTimer);
    p.items = [];
    p.turnId = null;
    p.nextTime = 0;
    setSpeakingTurn(null);
  }, []);

  /** Barge-in: stop speaking now and tell the gateway exactly how much was heard. */
  const interrupt = useCallback(() => {
    const p = play.current;
    if (!p.turnId) return false;
    const turnId = p.turnId;
    const heard = heardMs();
    cancelled.current.add(turnId);
    stopPlayback();
    send({ type: 'interrupt', turn_id: turnId, heard_ms: heard });
    return true;
  }, [heardMs, send, stopPlayback]);

  const onChunk = useCallback((data: ArrayBuffer) => {
    const c = ctx.current;
    if (!c || !outGain.current) return;
    const { header, pcm } = decodeAudioChunk(data);
    if (cancelled.current.has(header.turn_id)) return;
    const p = play.current;
    if (p.turnId !== header.turn_id) {
      stopPlayback();
      Object.assign(p, { turnId: header.turn_id, nextTime: 0, items: [], startedSent: false, ended: false, endTimer: null });
      setSpeakingTurn(header.turn_id);
    }
    const buf = c.createBuffer(1, pcm.length, header.sample_rate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(outGain.current);
    const when = Math.max(c.currentTime + 0.05, p.nextTime);
    src.start(when);
    p.nextTime = when + buf.duration;
    p.items.push({ src, when, startMs: header.start_ms, dur: buf.duration });
    if (!p.startedSent) {
      p.startedSent = true;
      const turnId = header.turn_id;
      setTimeout(() => { if (play.current.turnId === turnId) send({ type: 'playback', turn_id: turnId, event: 'started' }); }, Math.max(0, (when - c.currentTime) * 1000));
    }
  }, [send, stopPlayback]);

  const onAssistantEnd = useCallback((turnId: string) => {
    const p = play.current;
    const c = ctx.current;
    if (p.turnId !== turnId || !c) return;
    p.ended = true;
    p.endTimer = setTimeout(() => {
      if (play.current.turnId !== turnId) return;
      heardTurns.current.add(turnId);
      send({ type: 'playback', turn_id: turnId, event: 'ended' });
      play.current.turnId = null;
      play.current.items = [];
      setSpeakingTurn(null);
    }, Math.max(0, (p.nextTime - c.currentTime) * 1000) + 30);
  }, [send]);

  const handle = useCallback((m: ServerMessage) => {
    switch (m.type) {
      case 'ready': {
        authed.current = true;
        retries.current = 0;
        setPersona(m.persona);
        setAsrInfo({ provider: m.asr.provider, partials: m.asr.partials });
        optsRef.current.onView(m.view);
        send({ type: 'listen', mic_ready_ms: firstReady.current ? Math.round(performance.now() - micGrantedAt.current) : undefined });
        if (speedRef.current !== 'normal') send({ type: 'speed', speed: speedRef.current });
        // Speak the opening line once (only if this conversation has not been heard yet).
        const turns = (m.view as { turns: Array<{ turn_id: string; speaker: string }> }).turns;
        const last = turns.at(-1);
        if (firstReady.current && last?.speaker === 'assistant' && !turns.some((t) => t.speaker === 'learner')) send({ type: 'replay', turn_id: last.turn_id, speed: speedRef.current });
        if (!firstReady.current) setNotice('Соединение восстановлено. Если фраза оборвалась — повторите её.');
        firstReady.current = false;
        return;
      }
      case 'state':
        if (!paused.current || m.state === 'paused') setStatus(m.state);
        if (m.state === 'listening' || m.state === 'speech') setPending((p) => (m.state === 'speech' ? null : p));
        return;
      case 'vad':
        if (m.event === 'speech_start') { setPartial(null); setNotice(null); }
        return;
      case 'partial': setPartial(m.text); return;
      case 'final':
        setPartial(null);
        if (m.empty) setNotice('Не расслышал(а). Можно повторить — это не ошибка.');
        else if (m.needs_confirmation) setPending({ utterance_id: m.utterance_id, text: m.text, reason: m.reason, confidence: m.confidence });
        return;
      case 'turn':
        setPending(null);
        optsRef.current.onView(m.view);
        optsRef.current.onTurnMeta?.({ engine: m.engine, hint_ru: m.hint_ru });
        return;
      case 'assistant_start':
        cancelled.current.delete(m.turn_id);
        optsRef.current.onAssistantText?.(m.turn_id, m.text);
        return;
      case 'assistant_end': onAssistantEnd(m.turn_id); return;
      case 'assistant_text_only': setNotice(m.reason); return;
      case 'interrupted': return;
      case 'metrics': return;
      case 'error':
        setError(m.message);
        if (m.fatal) { stopping.current = true; setStatus('error'); }
        return;
    }
  }, [onAssistantEnd, send]);

  const connect = useCallback(async (): Promise<boolean> => {
    setStatus((s) => (s === 'network_lost' ? s : 'connecting'));
    let tok: { token: string; url: string };
    try {
      const r = await fetch('/api/speaking/stream-token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session_id: optsRef.current.sessionId }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(j.message ?? 'Потоковый канал недоступен.'); setStatus(r.status === 503 ? 'unsupported' : 'error'); return false; }
      tok = j;
    } catch {
      return false;
    }
    return new Promise<boolean>((resolve) => {
      const sock = new WebSocket(tok.url);
      sock.binaryType = 'arraybuffer';
      ws.current = sock;
      authed.current = false;
      sock.onopen = () => { sock.send(JSON.stringify({ type: 'auth', token: tok.token, input_source: inputSource(), speed: speedRef.current })); resolve(true); };
      sock.onmessage = (e) => { if (typeof e.data === 'string') handle(JSON.parse(e.data) as ServerMessage); else onChunk(e.data as ArrayBuffer); };
      sock.onerror = () => resolve(false);
      sock.onclose = () => {
        authed.current = false;
        if (ws.current !== sock || stopping.current) return;
        // Network drop: keep the mic, reconnect with a fresh token; the server state is authoritative.
        stopPlayback();
        setStatus('network_lost');
        const attempt = retries.current++;
        if (attempt >= 6) { setStatus('error'); setError('Не удалось восстановить соединение. Попробуйте позже или перейдите в пошаговый режим.'); return; }
        setTimeout(() => { if (!stopping.current) reconnect.current(); }, Math.min(8000, 800 * 2 ** attempt));
      };
    });
  }, [handle, onChunk, stopPlayback]);
  useEffect(() => { reconnect.current = () => { void connect(); }; }, [connect]);

  const levelLoop = useRef<number | null>(null);
  const startLevelLoop = useCallback(() => {
    if (levelLoop.current) cancelAnimationFrame(levelLoop.current);
    const data = new Float32Array(512);
    const tick = () => {
      const a = outAnalyser.current;
      if (a) {
        a.getFloatTimeDomainData(data);
        let s = 0;
        for (const v of data) s += v * v;
        outLevel.current = Math.min(1, Math.sqrt(s / data.length) * 4);
      }
      levelLoop.current = requestAnimationFrame(tick);
    };
    tick();
  }, []);

  /** Starts the live conversation. Must be called from a user gesture (mic permission). */
  const start = useCallback(async () => {
    if (!streamSupported()) { setStatus('unsupported'); return; }
    setError(null);
    stopping.current = false;
    const c = ctx.current ?? new AudioContext({ latencyHint: 'interactive' });
    ctx.current = c;
    await c.resume();
    setStatus('requesting_microphone');
    try {
      mic.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    } catch (e) {
      const n = (e as DOMException)?.name;
      setStatus(n === 'NotAllowedError' || n === 'SecurityError' ? 'permission_denied' : 'error');
      return;
    }
    micGrantedAt.current = performance.now();
    try {
      if (workletCtx.current !== c) await c.audioWorklet.addModule('/voice-capture-worklet.js');
      workletCtx.current = c;
    } catch {
      setStatus('unsupported');
      return;
    }
    const src = c.createMediaStreamSource(mic.current);
    const n = new AudioWorkletNode(c, 'greekos-capture', { processorOptions: { targetRate: INPUT_SAMPLE_RATE, packetSamples: 640 } });
    const sink = c.createGain();
    sink.gain.value = 0;
    src.connect(n);
    n.connect(sink).connect(c.destination);
    node.current = n;
    const g = c.createGain();
    const an = c.createAnalyser();
    an.fftSize = 512;
    g.connect(an).connect(c.destination);
    outGain.current = g;
    outAnalyser.current = an;
    startLevelLoop();
    n.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; rms: number }>) => {
      const { pcm, rms } = e.data;
      micLevel.current = Math.min(1, rms * 4);
      const db = rms > 0 ? 20 * Math.log10(rms) : -120;
      // Client barge-in: clear speech over the (echo-cancelled) mic while the assistant is talking.
      const speaking = !!play.current.turnId;
      if (!speaking && db < noiseFloor.current + 6) noiseFloor.current = noiseFloor.current * 0.97 + Math.max(-90, db) * 0.03;
      if (speaking && autoRef.current) {
        if (db > Math.max(noiseFloor.current + 20, -38)) {
          loudSince.current ??= performance.now();
          if (performance.now() - loudSince.current >= 250) { loudSince.current = null; interrupt(); }
        } else loudSince.current = null;
      }
      if (!paused.current && authed.current && ws.current?.readyState === WebSocket.OPEN) ws.current.send(pcm);
    };
    await connect();
  }, [connect, interrupt, startLevelLoop]);

  const stop = useCallback(() => {
    stopping.current = true;
    stopPlayback();
    ws.current?.close();
    ws.current = null;
    authed.current = false;
    node.current?.disconnect();
    node.current = null;
    mic.current?.getTracks().forEach((t) => t.stop());
    mic.current = null;
    if (levelLoop.current) cancelAnimationFrame(levelLoop.current);
    micLevel.current = 0;
    outLevel.current = 0;
    setPartial(null);
    setStatus('idle');
  }, [stopPlayback]);

  useEffect(() => () => {
    stopping.current = true;
    ws.current?.close();
    mic.current?.getTracks().forEach((t) => t.stop());
    if (levelLoop.current) cancelAnimationFrame(levelLoop.current);
    void ctx.current?.close();
  }, []);

  const pause = useCallback(() => { interrupt(); paused.current = true; send({ type: 'pause' }); setStatus('paused'); }, [interrupt, send]);
  const resume = useCallback(() => { paused.current = false; send({ type: 'resume' }); }, [send]);
  const done = useCallback(() => send({ type: 'done' }), [send]);
  const replay = useCallback((turnId: string, s: Speed) => { interrupt(); send({ type: 'replay', turn_id: turnId, speed: s }); }, [interrupt, send]);
  const setSpeed = useCallback((s: Speed) => { setSpeedState(s); send({ type: 'speed', speed: s }); }, [send]);
  const confirm = useCallback((text: string, edited: boolean) => {
    const p = pending;
    if (!p) return;
    send({ type: 'confirm', utterance_id: p.utterance_id, text, edited });
    setPending(null);
  }, [pending, send]);
  const discard = useCallback(() => { if (pending) send({ type: 'discard', utterance_id: pending.utterance_id }); setPending(null); setNotice('Скажите фразу ещё раз — без штрафа.'); }, [pending, send]);
  const repair = useCallback(() => { interrupt(); send({ type: 'repair' }); }, [interrupt, send]);
  const helpUsed = useCallback((kind: string) => send({ type: 'help_used', kind }), [send]);

  return {
    status, partial, pending, notice, error, persona, asrInfo, speakingTurn, speed, autoBargeIn,
    micLevel, outLevel, heardTurns,
    start, stop, pause, resume, done, interrupt, replay, setSpeed, setAutoBargeIn, confirm, discard, repair, helpUsed,
  };
}
