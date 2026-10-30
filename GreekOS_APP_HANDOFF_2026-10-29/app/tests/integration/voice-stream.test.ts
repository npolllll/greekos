import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { admin, createUser, deleteUser, type TestUser } from './helpers';
import { startVoiceGateway, type RunningGateway } from '@/lib/speaking/gateway';
import { mintStreamToken } from '@/lib/speaking/stream-token';
import { decodeAudioChunk, GATEWAY_PATH, FRAME_SAMPLES, type ServerMessage } from '@/lib/speaking/stream-protocol';
import { startSession } from '@/lib/speaking/service';
import { sayToWav, localAsrHealth, listLocalGreekVoices, listServiceVoices, serviceTts } from '@/lib/providers/local-engines';
import { parseWav, pcmSamples } from '@/lib/audio/wav';
import { syncLocalVoices, proposeCastVoices } from '@/lib/voice/catalog';

/**
 * End-to-end streaming duplex against the real gateway, local database, local Whisper ASR and a local
 * Greek voice (macOS `say`, or the GreekOS speech service on Linux). Learner "speech" is a synthetic
 * TTS clip streamed in real time and is labelled synthetic_test_clip in the metrics — it is not a
 * substitute for live learner recordings.
 */
const isMac = process.platform === 'darwin';
const canTry = isMac || process.platform === 'linux';
let engine: 'mac' | 'service' | null = null;
let gw: RunningGateway;
let owner: TestUser;
let ready = false;
let melina = '';
const SECRET = () => process.env.VOICE_GATEWAY_SECRET!;

beforeAll(async () => {
  process.env.APP_ENV = 'local';
  if (!(await localAsrHealth())) return;
  const v = isMac ? (await listLocalGreekVoices())[0] : undefined;
  const sv = (await listServiceVoices()).filter((x) => x.available);
  if (v) { engine = 'mac'; melina = v.id; }
  else if (sv.length) { engine = 'service'; melina = (sv.find((x) => x.id === 'coqui-el-css10') ?? sv[0]).id; }
  else return;
  await syncLocalVoices();
  await proposeCastVoices();
  gw = await startVoiceGateway({ port: 0 });
  owner = await createUser({ owner: true });
  ready = true;
}, 120_000);

afterAll(async () => {
  await gw?.close();
  if (owner) await deleteUser(owner);
});

class Client {
  ws: WebSocket;
  msgs: ServerMessage[] = [];
  chunks: Array<{ turn_id: string; seq: number; sentence: number; samples: number; at: number }> = [];
  closed: { code: number; reason: string } | null = null;
  constructor(port: number, origin?: string) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}${GATEWAY_PATH}`, origin ? { headers: { origin } } : {});
    this.ws.on('message', (d, bin) => {
      if (bin) {
        const { header, pcm } = decodeAudioChunk(new Uint8Array(d as Buffer));
        this.chunks.push({ turn_id: header.turn_id, seq: header.seq, sentence: header.sentence, samples: pcm.length, at: Date.now() });
      } else this.msgs.push(JSON.parse(d.toString()));
    });
    this.ws.on('close', (code, reason) => { this.closed = { code, reason: reason.toString() }; });
  }
  open() { return new Promise<void>((res, rej) => { this.ws.once('open', () => res()); this.ws.once('error', rej); }); }
  send(m: Record<string, unknown>) { this.ws.send(JSON.stringify(m)); }
  async waitFor<T extends ServerMessage['type']>(type: T, pred: (m: Extract<ServerMessage, { type: T }>) => boolean = () => true, timeoutMs = 30_000): Promise<Extract<ServerMessage, { type: T }>> {
    const t0 = Date.now();
    for (;;) {
      const hit = this.msgs.find((m) => m.type === type && pred(m as Extract<ServerMessage, { type: T }>));
      if (hit) return hit as Extract<ServerMessage, { type: T }>;
      const err = this.msgs.find((m) => m.type === 'error');
      if (err && type !== 'error') throw new Error(`gateway error: ${JSON.stringify(err)}`);
      if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${type}; got ${this.msgs.map((m) => m.type).join(',')}`);
      await new Promise((r) => setTimeout(r, 25));
    }
  }
  /** Streams PCM16 16 kHz in 20 ms frames at real-time pace, with leading/trailing silence. */
  async speak(pcm: Int16Array, { leadMs = 400, tailMs = 2400 } = {}) {
    const silence = (ms: number) => new Int16Array((16 * ms) | 0).map(() => Math.round((Math.random() - 0.5) * 40));
    const all = new Int16Array(silence(leadMs).length + pcm.length + silence(tailMs).length);
    all.set(silence(leadMs), 0); all.set(pcm, silence(leadMs).length); all.set(silence(tailMs), silence(leadMs).length + pcm.length);
    const step = FRAME_SAMPLES * 2; // 40 ms per message
    const t0 = Date.now();
    for (let o = 0, k = 0; o < all.length; o += step, k++) {
      const part = all.slice(o, o + step);
      this.ws.send(Buffer.from(part.buffer));
      const due = t0 + (k + 1) * 40;
      const wait = due - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
  }
}

async function clip(text: string): Promise<Int16Array> {
  const wav = engine === 'mac' ? await sayToWav(text, melina, 1, 16000) : (await serviceTts(melina, text, 'normal')).wav;
  const info = parseWav(wav)!;
  const pcm = pcmSamples(wav, info);
  if (info.sampleRate === 16000) return pcm;
  // The gateway takes 16 kHz frames: linear resampling is enough for a test clip.
  const out = new Int16Array(Math.floor((pcm.length * 16000) / info.sampleRate));
  for (let i = 0; i < out.length; i++) {
    const x = (i * info.sampleRate) / 16000;
    const k = Math.floor(x);
    const f = x - k;
    out[i] = Math.round((pcm[k] ?? 0) * (1 - f) + (pcm[k + 1] ?? pcm[k] ?? 0) * f);
  }
  return out;
}

async function connect(sessionId: string, opts: { origin?: string; token?: string } = {}) {
  const c = new Client(gw.port, opts.origin);
  await c.open();
  c.send({ type: 'auth', token: opts.token ?? mintStreamToken(SECRET(), owner.id, sessionId), input_source: 'synthetic_test_clip' });
  return c;
}

async function newSession(scenario = 'SC01', mode: 'roleplay' | 'b2_mock' = 'roleplay') {
  const v = await startSession(owner.session, { scenario_id: scenario, mode, input_mode: 'voice', idempotency_key: randomUUID(), voice_persona: 'TUTOR_F', transport: 'stream_local_gateway' });
  return v.session_id;
}

describe('streaming voice gateway', () => {
  it.skipIf(!canTry)('rejects bad, reused and cross-origin credentials', async () => {
    if (!ready) return;
    const sid = await newSession();
    const bad = await connect(sid, { token: 'x.y' });
    await bad.waitFor('error', (m) => m.code === 'BAD_TOKEN');
    const token = mintStreamToken(SECRET(), owner.id, sid);
    const first = await connect(sid, { token });
    await first.waitFor('ready');
    const reused = await connect(sid, { token });
    await reused.waitFor('error', (m) => m.code === 'BAD_TOKEN');
    const other = mintStreamToken('another-secret-another-secret-0123456789', owner.id, sid);
    const forged = await connect(sid, { token: other });
    await forged.waitFor('error', (m) => m.code === 'BAD_TOKEN');
    const evil = new Client(gw.port, 'https://evil.example');
    await expect(evil.open()).rejects.toThrow();
    const preAuthAudio = new Client(gw.port);
    await preAuthAudio.open();
    preAuthAudio.ws.send(Buffer.alloc(640));
    await preAuthAudio.waitFor('error', (m) => m.code === 'UNAUTHENTICATED');
    for (const c of [first]) c.ws.close();
  });

  it.skipIf(!canTry)('learner speech → VAD → Whisper → dialogue → streamed persona voice, with barge-in, metrics and idempotent recovery', async () => {
    if (!ready) return;
    const sid = await newSession();
    const c = await connect(sid);
    const r = await c.waitFor('ready');
    expect(r.persona.presentation).toBe('female');
    expect(['local_macos', 'local_coqui']).toContain(r.persona.provider);
    expect(r.asr).toMatchObject({ provider: 'local', partials: true, native_streaming: false });
    c.send({ type: 'listen', mic_ready_ms: 120 });
    await c.waitFor('state', (m) => m.state === 'listening');

    // Turn 1: answer the opening line; the reply streams back sentence by sentence.
    await c.speak(await clip('Θέλω ένα κιλό μήλα. Πόσο κάνουν;'));
    await c.waitFor('vad', (m) => m.event === 'end_of_turn');
    const fin = await c.waitFor('final');
    expect(fin.empty).toBe(false);
    // Real recognition, real errors (e.g. «κυλόμιλα» for «κιλό μήλα» with Whisper small): assert Greek, not exact text.
    expect(fin.text).toMatch(/Θέλω|κάνουν/);
    if (fin.needs_confirmation) c.send({ type: 'confirm', utterance_id: fin.utterance_id, text: fin.text, edited: false });
    const turn = await c.waitFor('turn');
    const view = turn.view as { turns: Array<{ speaker: string; source: string | null; text: string; turn_id: string }> };
    const learner = view.turns.filter((t) => t.speaker === 'learner');
    expect(learner).toHaveLength(1);
    expect(['asr_auto', 'asr_confirmed']).toContain(learner[0].source);
    const start1 = await c.waitFor('assistant_start');
    expect(start1.sentences.length).toBeGreaterThanOrEqual(2);
    await c.waitFor('assistant_end', (m) => m.turn_id === start1.turn_id);
    const chunks1 = c.chunks.filter((k) => k.turn_id === start1.turn_id);
    expect(chunks1.length).toBeGreaterThan(3);
    expect(new Set(chunks1.map((k) => k.sentence)).size).toBe(start1.sentences.length);
    // First audio left the gateway before the last sentence did (incremental, not one long WAV).
    expect(chunks1[0].at).toBeLessThan(chunks1.at(-1)!.at);
    c.send({ type: 'playback', turn_id: start1.turn_id, event: 'started' });
    c.send({ type: 'playback', turn_id: start1.turn_id, event: 'ended' });
    const m1 = await c.waitFor('metrics');
    expect(m1.metrics.asr_final_ms).toBeGreaterThan(0);
    expect(m1.metrics.tts_first_audio_ms).toBeGreaterThan(0);

    // Turn 2: the reply is interrupted after ~0.6 s — only the heard part becomes context.
    await c.speak(await clip('Ναι, θέλω δύο κιλά αχλάδια, παρακαλώ.'));
    const fin2 = await c.waitFor('final', (m) => m.utterance_id !== fin.utterance_id);
    if (fin2.needs_confirmation) c.send({ type: 'confirm', utterance_id: fin2.utterance_id, text: fin2.text, edited: false });
    const start2 = await c.waitFor('assistant_start', (m) => m.turn_id !== start1.turn_id);
    await new Promise((r) => setTimeout(r, 150));
    c.send({ type: 'playback', turn_id: start2.turn_id, event: 'started' });
    c.send({ type: 'interrupt', turn_id: start2.turn_id, heard_ms: 600 });
    const intr = await c.waitFor('interrupted');
    expect(intr.heard_ms).toBe(600);
    const { data: aTurn } = await admin.from('speaking_turns').select('interrupted, heard_ms, heard_text, text_el').eq('turn_id', start2.turn_id).single();
    expect(aTurn).toMatchObject({ interrupted: true, heard_ms: 600 });
    expect((aTurn!.heard_text ?? '').length).toBeLessThan(aTurn!.text_el.length);

    let rows: Array<Record<string, any>> = [];
    await expect.poll(async () => {
      rows = (await admin.from('speaking_turn_metrics').select('*').eq('session_id', sid).order('turn_seq')).data ?? [];
      return rows.filter((x) => x.turn_seq > 0).length;
    }, { timeout: 10_000 }).toBe(2);
    expect(rows.find((x) => x.turn_seq === 0)?.listen_ready_ms).toBe(120);
    const learnerRows = rows.filter((x) => x.turn_seq > 0);
    expect(learnerRows.length).toBe(2);
    expect(learnerRows.every((x) => x.input_source === 'synthetic_test_clip' && x.asr_engine?.startsWith('local:'))).toBe(true);
    expect(learnerRows[0].playback_start_ms).toBeGreaterThan(0);
    expect(learnerRows[0].end_of_speech_to_audio_ms).toBeGreaterThanOrEqual(learnerRows[0].playback_start_ms);
    expect(learnerRows[1].interrupted).toBe(true);
    c.ws.close();

    // Network drop: reconnect with a fresh token; a re-sent confirm for an already committed
    // utterance is deduplicated (no doubled learner turn), and the state comes back intact.
    const before = (await admin.from('speaking_turns').select('turn_id').eq('session_id', sid)).data!.length;
    const c2 = await connect(sid);
    const r2 = await c2.waitFor('ready');
    expect((r2.view as { turns: unknown[] }).turns).toHaveLength(before);
    c2.send({ type: 'confirm', utterance_id: fin.utterance_id, text: fin.text, edited: false });
    await c2.waitFor('turn');
    const after = (await admin.from('speaking_turns').select('turn_id').eq('session_id', sid)).data!.length;
    expect(after).toBe(before);
    c2.ws.close();
  }, 180_000);

  it.skipIf(!canTry)('pause drops audio, exam simulation refuses slow replay', async () => {
    if (!ready) return;
    const sid = await newSession();
    const c = await connect(sid);
    await c.waitFor('ready');
    c.send({ type: 'pause' });
    await c.waitFor('state', (m) => m.state === 'paused');
    await c.speak(await clip('Καλημέρα.'), { leadMs: 100, tailMs: 1800 });
    expect(c.msgs.some((m) => m.type === 'vad')).toBe(false);
    c.ws.close();

    const { data: b2s } = await admin.from('speaking_scenarios').select('scenario_id, payload->>module').eq('level', 'B2');
    const b2 = (b2s ?? []).find((x) => (x as { module?: string | null }).module !== 'real_greek');
    const exam = await newSession(b2!.scenario_id, 'b2_mock');
    const e = await connect(exam);
    const er = await e.waitFor('ready');
    const opening = (er.view as { turns: Array<{ turn_id: string }> }).turns[0];
    e.send({ type: 'replay', turn_id: opening.turn_id, speed: 'slow' });
    await e.waitFor('error', (m) => m.code === 'NO_SLOW_IN_EXAM');
    e.ws.close();
  }, 60_000);
});
