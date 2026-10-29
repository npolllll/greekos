import 'server-only';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { env } from '../env.ts';
import { adminClient } from '../supabase/admin.ts';
import { loadSessionUser, HttpError, type SessionUser } from '../session-user.ts';
import { verifyStreamToken, splitSentences } from './stream-token.ts';
import { Vad, vadConfigForLevel, speechLevelDbfs, type VadEvent } from './vad.ts';
import { learnerTurn, personaVoice, markInterrupted, sessionView, type LearnerSource, type SessionView } from './service.ts';
import { synthesizeWithVoice } from '../providers/speech.ts';
import { BudgetExceededError } from '../providers/budget.ts';
import { utteranceAsr, confirmationReason, type UtteranceAsr, type UtteranceTranscript } from '../providers/streaming-asr.ts';
import { parseWav, pcmSamples } from '../audio/wav.ts';
import type { CatalogVoice } from '../voice/catalog.ts';
import {
  STREAM_PROTOCOL, INPUT_SAMPLE_RATE, FRAME_SAMPLES, GATEWAY_PATH, encodeAudioChunk, heardTextAt,
  type ClientMessage, type ServerMessage, type Speed, type InputSource, type GatewayState,
} from './stream-protocol.ts';

/**
 * Streaming-duplex voice gateway (v5.4 §5). A long-lived process outside Vercel serverless:
 * microphone PCM in → adaptive VAD → partial/final ASR → dialogue engine (same service and
 * idempotency as the REST path) → sentence-chunked TTS streamed back while later sentences are
 * still being synthesized. Barge-in cancels pending speech and stores only what was heard.
 *
 * Auth: a 60 s single-use HMAC token minted by the Next.js server for one user + session.
 * Provider credentials stay in this process; the browser never receives them.
 */

const PRE_ROLL_FRAMES = 20;            // 400 ms kept before speech start
const PARTIAL_EVERY_MS = 1200;
const PARTIAL_MIN_SAMPLES = INPUT_SAMPLE_RATE * 0.8;
const PARTIAL_MAX_SAMPLES = INPUT_SAMPLE_RATE * 15;
const CHUNK_MS = 200;
const AUTH_TIMEOUT_MS = 5000;
const AUDIO_BUDGET_FACTOR = 8;         // max seconds of audio accepted per wall second (burst-limited)
const TTS_CACHE_MAX = 300;

interface TurnTiming {
  turnSeq: number;
  endOfTurnAt: number;
  endOfSpeechAt: number;
  speechMs: number | null;
  hangoverMs: number | null;
  partialFirstMs: number | null;
  asrFinalMs: number | null;
  asrEngine: string | null;
  dialogueMs: number | null;
  dialogueEngine: string | null;
  ttsFirstAudioMs: number | null;
  playbackStartMs: number | null;
  endOfSpeechToAudioMs: number | null;
  interrupted: boolean;
  heardMs: number | null;
  written: boolean;
}

interface Playback {
  turnId: string;
  gen: number;
  timeline: Array<{ text: string; start_ms: number; end_ms: number }>;
  replay: boolean;
  timing: TurnTiming | null;
  sentAll: boolean;
}

const usedJti = new Map<string, number>();
const ttsCache = new Map<string, Uint8Array>();

function rememberJti(jti: string, exp: number): boolean {
  const now = Math.floor(Date.now() / 1000);
  for (const [k, e] of usedJti) if (e < now) usedJti.delete(k);
  if (usedJti.has(jti)) return false;
  usedJti.set(jti, exp);
  return true;
}

function concat(chunks: Int16Array[]): Int16Array {
  const n = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Int16Array(n);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

class StreamSession {
  private user!: SessionUser;
  private sessionId!: string;
  private mode!: string;
  private voice: CatalogVoice | null = null;
  private personaId: string | null = null;
  private asr!: UtteranceAsr;
  private vad!: Vad;
  private level: string | null = null;
  private inputSource: InputSource = 'microphone';
  private speed: Speed = 'normal';
  private authed = false;
  private state: GatewayState = 'listening';
  private remainder = new Int16Array(0);
  private preRoll: Int16Array[] = [];
  private utter: Int16Array[] | null = null;
  private utterId: string | null = null;
  private utterDuringPlayback = false;
  private speechStartAt = 0;
  private partialFirstMs: number | null = null;
  private partialInFlight = false;
  private lastPartialAt = 0;
  private busy = false;
  private queued: { ev: Extract<VadEvent, { type: 'end_of_turn' }>; pcm: Int16Array; id: string; partialFirstMs: number | null; at: number } | null = null;
  private pendingConfirm = new Map<string, { tr: UtteranceTranscript; timing: TurnTiming }>();
  private helpUsed = new Set<string>();
  private playback: Playback | null = null;
  private gen = 0;
  private heardComplete = new Set<string>();
  private audioAllowanceMs = 10_000;
  private allowanceAt = Date.now();
  private closed = false;

  constructor(private ws: WebSocket) {}

  send(m: ServerMessage) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  private setState(s: GatewayState) {
    if (this.state === s) return;
    this.state = s;
    this.send({ type: 'state', state: s });
  }

  private fail(code: string, message: string, fatal = false) {
    this.send({ type: 'error', code, message, fatal });
    if (fatal) this.ws.close(1008, code);
  }

  close() {
    this.closed = true;
    this.gen++;
    if (this.playback?.timing) void this.writeMetrics(this.playback.timing);
  }

  async onMessage(data: RawData, isBinary: boolean) {
    if (isBinary) {
      if (!this.authed) return this.fail('UNAUTHENTICATED', 'Сначала авторизация.', true);
      return this.onAudio(data as Buffer);
    }
    let m: ClientMessage;
    try { m = JSON.parse(data.toString()) as ClientMessage; } catch { return this.fail('BAD_MESSAGE', 'Некорректное сообщение'); }
    if (!this.authed) {
      if (m.type !== 'auth') return this.fail('UNAUTHENTICATED', 'Сначала авторизация.', true);
      return this.authenticate(m);
    }
    try {
      switch (m.type) {
        case 'listen': return this.onListen(m.mic_ready_ms);
        case 'done': return this.onDone();
        case 'interrupt': return await this.onInterrupt(String(m.turn_id), Number(m.heard_ms));
        case 'pause': return this.onPause();
        case 'resume': return this.onResume();
        case 'replay': return this.spawn(() => this.onReplay(String(m.turn_id), m.speed));
        case 'speed': return this.onSpeed(m.speed);
        case 'confirm': return this.spawn(() => this.onConfirm(String(m.utterance_id), String(m.text ?? ''), !!m.edited));
        case 'discard': this.pendingConfirm.delete(String(m.utterance_id)); return this.setState('listening');
        case 'repair': return this.spawn(() => this.onRepair());
        case 'help_used': if (typeof m.kind === 'string' && m.kind.length <= 40 && this.helpUsed.size < 10) this.helpUsed.add(m.kind); return;
        case 'playback': return this.onPlayback(String(m.turn_id), m.event);
        default: return this.fail('BAD_MESSAGE', 'Неизвестная команда');
      }
    } catch (e) {
      this.handleError(e);
    }
  }

  get isAuthed() { return this.authed; }

  /** Long operations run beside the ordered message chain so audio and barge-in keep flowing. */
  private spawn(fn: () => Promise<void>) {
    fn().catch((e) => this.handleError(e));
  }

  private handleError(e: unknown) {
    if (e instanceof HttpError) return this.fail(e.code, e.message, e.status === 401 || e.status === 403);
    if (e instanceof BudgetExceededError) return this.fail('BUDGET_EXCEEDED', e.message);
    console.error('[voice-gateway]', (e as Error)?.message ?? e);
    this.fail('INTERNAL', 'Внутренняя ошибка голосового шлюза. Реплика не сохранена — можно повторить.');
    this.busy = false;
    this.setState('listening');
  }

  private async authenticate(m: Extract<ClientMessage, { type: 'auth' }>) {
    const secret = env.voiceGatewaySecret;
    const claims = secret ? verifyStreamToken(secret, String(m.token ?? '')) : null;
    if (!claims || !rememberJti(claims.jti, claims.exp)) return this.fail('BAD_TOKEN', 'Ссылка на голосовой канал недействительна или истекла.', true);
    const user = await loadSessionUser(claims.sub);
    if (!user) return this.fail('BAD_TOKEN', 'Пользователь не активен.', true);
    const db = adminClient();
    const { data: s } = await db.from('speaking_sessions').select('session_id, user_id, status, input_mode, mode, voice_persona, scenario_id').eq('session_id', claims.sid).maybeSingle();
    if (!s || s.user_id !== user.userId) return this.fail('NOT_FOUND', 'Разговор не найден.', true);
    if (s.status !== 'ACTIVE') return this.fail('SESSION_CLOSED', 'Разговор уже завершён.', true);
    if (s.input_mode !== 'voice') return this.fail('VOICE_SESSION', 'Потоковый канал только для голосового режима.', true);
    if (m.input_source === 'synthetic_test_clip' && !env.localEnginesAllowed) return this.fail('SYNTHETIC_INPUT', 'Синтетический вход разрешён только в тестовой среде.', true);
    try { this.asr = utteranceAsr(); } catch (e) { return this.fail('ASR_UNAVAILABLE', (e as Error).message, true); }
    const { data: sc } = await db.from('speaking_scenarios').select('level').eq('scenario_id', s.scenario_id).single();
    this.user = user;
    this.sessionId = s.session_id;
    this.mode = s.mode;
    this.level = s.mode === 'a0_guided' ? 'A0' : sc?.level ?? null;
    this.vad = new Vad(vadConfigForLevel(this.level));
    this.personaId = s.voice_persona ?? 'TUTOR_F';
    this.voice = await personaVoice(this.personaId);
    this.inputSource = m.input_source === 'synthetic_test_clip' ? 'synthetic_test_clip' : 'microphone';
    this.speed = m.speed === 'slow' && this.mode !== 'b2_mock' ? 'slow' : m.speed === 'fast' ? 'fast' : 'normal';
    this.authed = true;
    await db.from('speaking_sessions').update({ transport: 'stream_local_gateway' }).eq('session_id', s.session_id);
    const view = await sessionView(user, s.session_id);
    this.send({
      type: 'ready', protocol: STREAM_PROTOCOL, session_id: s.session_id,
      persona: { cast_role_id: this.personaId, voice_name: this.voice?.display_name ?? null, presentation: this.voice?.presentation ?? null, provider: this.voice?.provider ?? null, dev_only: this.voice ? !this.voice.distribution_allowed : false },
      asr: { provider: this.asr.provider, partials: this.asr.partials, native_streaming: this.asr.nativeStreaming },
      vad: { base_hangover_ms: this.vad.cfg.baseHangoverMs, max_hangover_ms: this.vad.cfg.maxHangoverMs },
      speed: this.speed, view,
    });
  }

  private onListen(micReadyMs?: number) {
    // Always acknowledged: the client shows «Слушаю» only after the gateway is ready for audio.
    this.state = 'listening';
    this.send({ type: 'state', state: 'listening' });
    if (typeof micReadyMs === 'number' && Number.isFinite(micReadyMs)) {
      void adminClient().from('speaking_turn_metrics').upsert({
        session_id: this.sessionId, user_id: this.user.userId, turn_seq: 0, transport: 'stream_local_gateway', asr_engine: this.asr.provider,
        tts_engine: this.voice?.provider ?? null, listen_ready_ms: Math.max(0, Math.round(micReadyMs)), input_source: this.inputSource,
      }, { onConflict: 'session_id,turn_seq' }).then(({ error }) => { if (error) console.error('[voice-gateway] metrics', error.message); });
    }
  }

  // ---- audio in -------------------------------------------------------------------------------

  private onAudio(buf: Buffer) {
    if (this.state === 'paused' || this.closed) return;
    // Burst-limited budget: synthetic clips may be faster than real time, but not unbounded.
    const now = Date.now();
    this.audioAllowanceMs = Math.min(10_000, this.audioAllowanceMs + (now - this.allowanceAt) * AUDIO_BUDGET_FACTOR);
    this.allowanceAt = now;
    const samples = Math.floor(buf.byteLength / 2);
    this.audioAllowanceMs -= (samples / INPUT_SAMPLE_RATE) * 1000;
    if (this.audioAllowanceMs < 0) return this.fail('RATE_LIMIT', 'Слишком много аудио за короткое время.', true);
    const aligned = new Int16Array(samples);
    for (let i = 0; i < samples; i++) aligned[i] = buf.readInt16LE(i * 2);
    const all = this.remainder.length ? concat([this.remainder, aligned]) : aligned;
    let o = 0;
    for (; o + FRAME_SAMPLES <= all.length; o += FRAME_SAMPLES) this.onFrame(all.subarray(o, o + FRAME_SAMPLES).slice());
    this.remainder = all.slice(o);
  }

  private onFrame(frame: Int16Array) {
    const ev = this.vad.push(frame);
    if (this.utter) this.utter.push(frame);
    else {
      this.preRoll.push(frame);
      if (this.preRoll.length > PRE_ROLL_FRAMES) this.preRoll.shift();
    }
    if (ev?.type === 'speech_start') {
      this.utter = [...this.preRoll];
      this.preRoll = [];
      this.utterId = randomUUID();
      this.utterDuringPlayback = this.state === 'speaking';
      this.speechStartAt = Date.now() - this.vad.cfg.minSpeechFrames * this.vad.cfg.frameMs;
      this.partialFirstMs = null;
      this.lastPartialAt = Date.now();
      this.send({ type: 'vad', event: 'speech_start' });
      if (!this.utterDuringPlayback && !this.busy) this.setState('speech');
    } else if (ev?.type === 'end_of_turn') {
      this.endUtterance(ev);
    } else if (this.utter && !this.utterDuringPlayback) {
      this.maybePartial();
    }
  }

  private maybePartial() {
    // No new partial once the learner has gone quiet: the final is coming and must not wait behind it.
    if (!this.asr.partials || this.partialInFlight || !this.utter || this.vad.trailingSilenceMs > 300) return;
    const now = Date.now();
    if (now - this.lastPartialAt < PARTIAL_EVERY_MS) return;
    const pcm = concat(this.utter);
    if (pcm.length < PARTIAL_MIN_SAMPLES) return;
    const id = this.utterId!;
    this.partialInFlight = true;
    this.lastPartialAt = now;
    this.asr.partial(pcm.subarray(Math.max(0, pcm.length - PARTIAL_MAX_SAMPLES)), INPUT_SAMPLE_RATE)
      .then((text) => {
        if (text && this.utterId === id && this.utter) {
          this.partialFirstMs ??= Date.now() - this.speechStartAt;
          this.send({ type: 'partial', utterance_id: id, text });
        }
      })
      .catch(() => undefined)
      .finally(() => { this.partialInFlight = false; });
  }

  private onDone() {
    const ev = this.vad.forceEnd();
    if (ev?.type === 'end_of_turn') this.endUtterance(ev);
  }

  private endUtterance(ev: Extract<VadEvent, { type: 'end_of_turn' }>) {
    const pcm = this.utter ? concat(this.utter) : new Int16Array(0);
    const id = this.utterId ?? randomUUID();
    const duringPlayback = this.utterDuringPlayback;
    this.utter = null;
    this.utterId = null;
    this.utterDuringPlayback = false;
    if (duringPlayback && this.state === 'speaking') {
      // Speech while the assistant was talking and the learner did not barge in (likely echo).
      this.send({ type: 'vad', event: 'ignored_during_playback' });
      return;
    }
    this.send({ type: 'vad', event: 'end_of_turn', hangover_ms: ev.hangoverMs, speech_ms: ev.speechMs });
    const item = { ev, pcm, id, partialFirstMs: this.partialFirstMs, at: Date.now() };
    if (this.busy) { this.queued = item; return; }
    void this.processUtterance(item);
  }

  private async processUtterance(item: { ev: Extract<VadEvent, { type: 'end_of_turn' }>; pcm: Int16Array; id: string; partialFirstMs: number | null; at: number }) {
    this.busy = true;
    try {
      this.setState('transcribing');
      // Wall-clock end of speech: frames arrive in real time, so the hangover is how long ago it was.
      const endOfSpeechAt = item.at - Math.max(0, item.ev.atMs - item.ev.lastVoicedMs);
      const t0 = Date.now();
      const tr = await this.asr.final(item.pcm, INPUT_SAMPLE_RATE, this.user.userId);
      const timing: TurnTiming = {
        turnSeq: -1, endOfTurnAt: item.at, endOfSpeechAt, speechMs: item.ev.speechMs, hangoverMs: item.ev.hangoverMs, partialFirstMs: item.partialFirstMs,
        asrFinalMs: Date.now() - t0, asrEngine: `${tr.provider}:${tr.model}`, dialogueMs: null, dialogueEngine: null, ttsFirstAudioMs: null,
        playbackStartMs: null, endOfSpeechToAudioMs: null, interrupted: false, heardMs: null, written: false,
      };
      if (!tr.text) {
        this.send({ type: 'final', utterance_id: item.id, text: '', confidence: tr.confidence, needs_confirmation: false, reason: null, empty: true });
        this.setState('listening');
        return;
      }
      // Speech-to-noise ratio from the adaptive noise floor: noisy audio is confirmed, never trusted blindly.
      const snrDb = speechLevelDbfs(item.pcm) - this.vad.noiseFloorDbfs;
      const reason = confirmationReason(tr, { snrDb });
      this.send({ type: 'final', utterance_id: item.id, text: tr.text, confidence: tr.confidence, needs_confirmation: !!reason, reason, empty: false });
      if (reason) {
        this.pendingConfirm.set(item.id, { tr, timing });
        this.setState('confirming');
        return;
      }
      await this.commit(item.id, tr.text, 'asr_auto', tr.confidence, timing);
    } catch (e) {
      this.handleError(e);
    } finally {
      this.busy = false;
      const q = this.queued;
      this.queued = null;
      if (q && !this.closed) void this.processUtterance(q);
    }
  }

  private async onConfirm(utteranceId: string, text: string, edited: boolean) {
    const p = this.pendingConfirm.get(utteranceId);
    this.pendingConfirm.delete(utteranceId);
    const clean = text.trim().slice(0, 1200);
    if (!clean) return this.fail('EMPTY_TURN', 'Пустая реплика не отправляется.');
    // A transcript counts as recognised-and-confirmed only if it is exactly what this gateway heard;
    // anything else (edited, or confirmed after a reconnect) is the learner's own correction.
    const source: LearnerSource = p && !edited && clean === p.tr.text ? 'asr_confirmed' : 'learner_corrected';
    const timing = p?.timing ?? null;
    if (this.busy) return this.fail('BUSY', 'Подождите окончания текущей реплики.');
    this.busy = true;
    try { await this.commit(utteranceId, clean, source, p?.tr.confidence ?? null, timing); } finally { this.busy = false; }
  }

  private async commit(utteranceId: string, text: string, source: LearnerSource, confidence: number | null, timing: TurnTiming | null) {
    this.setState('thinking');
    const t0 = Date.now();
    const res = await learnerTurn(this.user, {
      session_id: this.sessionId, text, source, asr_confidence: confidence, help_used: [...this.helpUsed], repair: false,
      interrupted_previous: false, idempotency_key: `stream:${utteranceId}`,
    }) as SessionView & { engine?: string; hint_ru?: string | null };
    this.helpUsed.clear();
    const learner = [...res.turns].reverse().find((t) => t.speaker === 'learner');
    if (timing) {
      timing.dialogueMs = Date.now() - t0;
      timing.dialogueEngine = res.engine ?? null;
      timing.turnSeq = learner?.seq ?? -1;
    }
    this.send({ type: 'turn', view: res, engine: res.engine ?? null, hint_ru: res.hint_ru ?? null });
    // Speech streams beside the dialogue lock: the learner may barge in or speak again meanwhile.
    this.spawn(() => this.speakLatest(res, timing));
  }

  private async onRepair() {
    if (this.busy) return this.fail('BUSY', 'Подождите окончания текущей реплики.');
    this.busy = true;
    try {
      await this.cancelPlayback();
      this.setState('thinking');
      const res = await learnerTurn(this.user, { session_id: this.sessionId, text: '', source: 'typed', asr_confidence: null, help_used: [...this.helpUsed], repair: true, interrupted_previous: false, idempotency_key: `stream-repair:${randomUUID()}` }) as SessionView & { engine?: string; hint_ru?: string | null };
      this.send({ type: 'turn', view: res, engine: res.engine ?? null, hint_ru: res.hint_ru ?? null });
      this.spawn(() => this.speakLatest(res, null));
    } finally {
      this.busy = false;
    }
  }

  private async speakLatest(view: SessionView, timing: TurnTiming | null) {
    const a = [...view.turns].reverse().find((t) => t.speaker === 'assistant');
    if (!a || !a.text) { this.setState('listening'); if (timing) await this.writeMetrics(timing); return; }
    await this.streamAssistant(a.turn_id, a.text, this.speed, false, timing);
  }

  // ---- speech out -----------------------------------------------------------------------------

  private async synth(text: string, speed: Speed): Promise<Uint8Array> {
    const key = `${this.voice!.voice_id}|${speed}|${text}`;
    const hit = ttsCache.get(key);
    if (hit) return hit;
    const r = await synthesizeWithVoice(text, this.voice!, { speed, userId: this.user.userId, operation: 'tts_dialogue_stream' });
    ttsCache.set(key, r.bytes);
    if (ttsCache.size > TTS_CACHE_MAX) ttsCache.delete(ttsCache.keys().next().value!);
    return r.bytes;
  }

  private async streamAssistant(turnId: string, text: string, speed: Speed, replay: boolean, timing: TurnTiming | null) {
    await this.cancelPlayback();
    const gen = ++this.gen;
    if (!this.voice) {
      this.send({ type: 'assistant_text_only', turn_id: turnId, text, reason: 'Для собеседника нет доступного голоса — реплика показана текстом.' });
      this.setState('listening');
      if (timing) await this.writeMetrics(timing);
      return;
    }
    const sentences = splitSentences(text);
    const pb: Playback = { turnId, gen, timeline: [], replay, timing, sentAll: false };
    this.playback = pb;
    this.send({ type: 'assistant_start', turn_id: turnId, text, sentences, speed, replay });
    this.setState('speaking');
    let offset = 0;
    let seq = 0;
    let next: Promise<Uint8Array> = this.synth(sentences[0], speed);
    for (let i = 0; i < sentences.length; i++) {
      let wav: Uint8Array;
      try {
        wav = await next;
      } catch (e) {
        if (gen !== this.gen) return;
        this.fail(e instanceof BudgetExceededError ? 'BUDGET_EXCEEDED' : 'TTS_FAILED', 'Синтез речи не удался — реплика показана текстом.');
        break;
      }
      if (gen !== this.gen || this.closed) return; // interrupted: drop the rest
      if (i + 1 < sentences.length) next = this.synth(sentences[i + 1], speed);
      const info = parseWav(wav);
      if (!info) continue;
      const pcm = pcmSamples(wav, info);
      if (i === 0 && timing) timing.ttsFirstAudioMs = Date.now() - timing.endOfTurnAt;
      const step = Math.round((info.sampleRate * CHUNK_MS) / 1000);
      for (let o = 0; o < pcm.length; o += step) {
        const part = pcm.subarray(o, Math.min(pcm.length, o + step));
        const last = i === sentences.length - 1 && o + step >= pcm.length;
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(encodeAudioChunk({ turn_id: turnId, seq: seq++, sentence: i, sample_rate: info.sampleRate, start_ms: offset + Math.round((o / info.sampleRate) * 1000), last }, part), { binary: true });
        }
      }
      pb.timeline.push({ text: sentences[i], start_ms: offset, end_ms: offset + info.durationMs });
      offset += info.durationMs;
    }
    if (gen !== this.gen) return;
    pb.sentAll = true;
    this.send({ type: 'assistant_end', turn_id: turnId, total_ms: offset });
    // The client reports when playback actually ends; without a report, fall back to the audio length.
    setTimeout(() => {
      if (this.playback === pb && gen === this.gen) this.finishPlayback(pb, true);
    }, offset + 3000).unref?.();
  }

  private onPlayback(turnId: string, event: 'started' | 'ended') {
    const pb = this.playback;
    if (!pb || pb.turnId !== turnId) return;
    if (event === 'started' && pb.timing && pb.timing.playbackStartMs == null) {
      const now = Date.now();
      pb.timing.playbackStartMs = now - pb.timing.endOfTurnAt;
      pb.timing.endOfSpeechToAudioMs = now - pb.timing.endOfSpeechAt;
    }
    if (event === 'ended') this.finishPlayback(pb, true);
  }

  private finishPlayback(pb: Playback, completed: boolean) {
    if (this.playback !== pb) return;
    this.playback = null;
    if (completed && pb.sentAll) this.heardComplete.add(pb.turnId);
    if (pb.timing) void this.writeMetrics(pb.timing);
    if (this.state === 'speaking') this.setState(this.utter ? 'speech' : 'listening');
  }

  private async cancelPlayback() {
    if (!this.playback) return;
    this.gen++;
    this.finishPlayback(this.playback, false);
  }

  private async onInterrupt(turnId: string, heardMsRaw: number) {
    const pb = this.playback;
    if (!pb || pb.turnId !== turnId) return;
    this.gen++; // stop sending the rest immediately
    const total = pb.timeline.at(-1)?.end_ms ?? 0;
    const heardMs = Math.max(0, Math.min(Number.isFinite(heardMsRaw) ? heardMsRaw : 0, pb.sentAll ? total : Number.MAX_SAFE_INTEGER));
    const heardText = heardTextAt(pb.timeline, heardMs);
    // A replay of a line the learner already heard in full does not truncate the dialogue context.
    if (!this.heardComplete.has(turnId)) await markInterrupted(this.user.userId, this.sessionId, turnId, heardMs, heardText);
    if (pb.timing) { pb.timing.interrupted = true; pb.timing.heardMs = heardMs; await this.writeMetrics(pb.timing); }
    this.utterDuringPlayback = false; // the learner is talking on purpose: keep the utterance
    this.send({ type: 'interrupted', turn_id: turnId, heard_ms: heardMs, heard_text: heardText });
    this.finishPlayback(pb, false);
    this.setState(this.utter ? 'speech' : 'listening');
  }

  private async onReplay(turnId: string, speed: Speed) {
    if (speed === 'slow' && this.mode === 'b2_mock') return this.fail('NO_SLOW_IN_EXAM', 'В экзаменационной симуляции замедление отключено.');
    const { data: t } = await adminClient().from('speaking_turns').select('turn_id, session_id, speaker, text_el').eq('turn_id', turnId).maybeSingle();
    if (!t || t.session_id !== this.sessionId || t.speaker !== 'assistant' || !t.text_el) return this.fail('NOT_FOUND', 'Реплика не найдена.');
    await this.streamAssistant(t.turn_id, t.text_el, speed === 'slow' || speed === 'fast' ? speed : 'normal', true, null);
  }

  private onSpeed(speed: Speed) {
    if (speed === 'slow' && this.mode === 'b2_mock') return this.fail('NO_SLOW_IN_EXAM', 'В экзаменационной симуляции замедление отключено.');
    this.speed = speed === 'slow' || speed === 'fast' ? speed : 'normal';
  }

  private onPause() {
    this.gen++;
    if (this.playback) this.finishPlayback(this.playback, false);
    this.utter = null;
    this.utterId = null;
    this.preRoll = [];
    this.setState('paused');
  }

  private onResume() {
    this.vad = new Vad(vadConfigForLevel(this.level));
    this.remainder = new Int16Array(0);
    this.setState('listening');
  }

  private async writeMetrics(t: TurnTiming) {
    if (t.written || t.turnSeq < 0) return;
    t.written = true;
    const { error } = await adminClient().from('speaking_turn_metrics').upsert({
      session_id: this.sessionId, user_id: this.user.userId, turn_seq: t.turnSeq, transport: 'stream_local_gateway',
      asr_engine: t.asrEngine, tts_engine: this.voice ? `${this.voice.provider}:${this.voice.provider_voice_name}` : null, dialogue_engine: t.dialogueEngine,
      speech_ms: t.speechMs, vad_hangover_ms: t.hangoverMs, asr_partial_first_ms: t.partialFirstMs, asr_final_ms: t.asrFinalMs,
      llm_first_token_ms: t.dialogueMs, tts_first_audio_ms: t.ttsFirstAudioMs, playback_start_ms: t.playbackStartMs,
      end_of_speech_to_audio_ms: t.endOfSpeechToAudioMs, interrupted: t.interrupted, heard_ms: t.heardMs, input_source: this.inputSource,
    }, { onConflict: 'session_id,turn_seq' });
    if (error) console.error('[voice-gateway] metrics', error.message);
    this.send({
      type: 'metrics', turn_seq: t.turnSeq, metrics: {
        speech_ms: t.speechMs, vad_hangover_ms: t.hangoverMs, asr_partial_first_ms: t.partialFirstMs, asr_final_ms: t.asrFinalMs, dialogue_ms: t.dialogueMs,
        tts_first_audio_ms: t.ttsFirstAudioMs, playback_start_ms: t.playbackStartMs, end_of_speech_to_audio_ms: t.endOfSpeechToAudioMs, interrupted: t.interrupted,
      },
    });
  }
}

function originAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return env.localEnginesAllowed; // non-browser clients only in local/test
  const allowed = new Set([new URL(env.appUrl).origin, ...(process.env.VOICE_GATEWAY_ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean)]);
  if (env.localEnginesAllowed) { allowed.add('http://localhost:3210'); allowed.add('http://127.0.0.1:3210'); }
  return allowed.has(origin);
}

export interface RunningGateway { server: Server; port: number; sessions: () => number; close: () => Promise<void> }

export async function startVoiceGateway(opts: { port: number; host?: string }): Promise<RunningGateway> {
  if (!env.voiceGatewaySecret || env.voiceGatewaySecret.length < 32) throw new Error('VOICE_GATEWAY_SECRET (≥32 символа) не задан.');
  const live = new Set<StreamSession>();
  const server = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, protocol: STREAM_PROTOCOL, sessions: live.size }));
      return;
    }
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    if (path !== GATEWAY_PATH || !originAllowed(req)) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  wss.on('connection', (ws: WebSocket & { alive?: boolean }) => {
    const s = new StreamSession(ws);
    live.add(s);
    ws.alive = true;
    ws.on('pong', () => { ws.alive = true; });
    const authTimer = setTimeout(() => { if (!s.isAuthed) ws.close(1008, 'AUTH_TIMEOUT'); }, AUTH_TIMEOUT_MS);
    // Messages are handled strictly in order so control and audio frames never race.
    let chain = Promise.resolve();
    ws.on('message', (data, isBinary) => { chain = chain.then(() => s.onMessage(data, isBinary)).catch(() => undefined); });
    ws.on('close', () => { clearTimeout(authTimer); s.close(); live.delete(s); });
  });
  const ping = setInterval(() => {
    for (const ws of wss.clients as Set<WebSocket & { alive?: boolean }>) {
      if (ws.alive === false) { ws.terminate(); continue; }
      ws.alive = false;
      ws.ping();
    }
  }, 15_000);
  ping.unref();
  await new Promise<void>((resolve) => server.listen(opts.port, opts.host ?? '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return {
    server, port, sessions: () => live.size,
    close: () => new Promise<void>((resolve) => { clearInterval(ping); for (const ws of wss.clients) ws.terminate(); wss.close(); server.close(() => resolve()); }),
  };
}
