/**
 * Live voice smoke test of a running voice gateway — local or deployed (wss://…): a temporary synthetic
 * account starts a scene, a synthetic Greek learner (cloud voice when TTS is cloud, else the local
 * service) speaks in real time, and every turn is checked end to end: recognition → dialogue →
 * sentence-by-sentence voice → playback. Turn 2 is interrupted (barge-in); the session is ended and
 * its summary read back. Reports end of speech → first audible reply (p50/p95) per mandate §5.5.
 *
 *   npx tsx --conditions=react-server scripts/voice-smoke.ts --gateway wss://voice.example.com [--turns 4] [--out reports/v8/voice-smoke]
 *
 * Needs the app's server env (Supabase URL + service role key, VOICE_GATEWAY_SECRET, provider keys).
 * The temporary account is a test account with the owner role (scenes need no release decision; the
 * gateway accepts synthetic speech only from test accounts) and is deleted at the end.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import WebSocket from 'ws';
import { adminClient } from '../src/lib/supabase/admin.ts';
import { env } from '../src/lib/env.ts';
import type { SessionUser } from '../src/lib/session-user.ts';
import { mintStreamToken } from '../src/lib/speaking/stream-token.ts';
import { decodeAudioChunk, GATEWAY_PATH, FRAME_SAMPLES, type ServerMessage } from '../src/lib/speaking/stream-protocol.ts';
import { startSession, endSession } from '../src/lib/speaking/service.ts';
import { listServiceVoices, serviceTts } from '../src/lib/providers/local-engines.ts';
import { synthesizeWithVoice, ttsStatus } from '../src/lib/providers/speech.ts';
import { loadCatalog } from '../src/lib/voice/catalog.ts';
import { parseWav, pcmSamples } from '../src/lib/audio/wav.ts';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const gateway = arg('--gateway', process.env.NEXT_PUBLIC_VOICE_GATEWAY_URL ?? 'ws://127.0.0.1:3311').replace(/\/$/, '');
const turns = Number(arg('--turns', '4'));
const out = arg('--out', 'reports/v8/voice-smoke');
const LINES = ['Καλημέρα. Θέλω ένα καφέ, παρακαλώ.', 'Ναι, έναν μεγάλο φρέντο χωρίς ζάχαρη.', 'Θα μείνω εδώ, περιμένω μια φίλη.', 'Πόσο κάνει; Ευχαριστώ πολύ!'];
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };

/** Learner speech as 16 kHz PCM: a cloud voice (other presentation than the persona) or the local service. */
async function learnerClip(text: string, user: SessionUser): Promise<Int16Array> {
  let wav: Uint8Array;
  if (ttsStatus().provider !== 'local') {
    const cat = [...(await loadCatalog()).values()].filter((v) => v.engine_kind === 'cloud' && v.available && v.presentation === 'male');
    if (!cat.length) throw new Error('Нет облачного мужского голоса для синтетического ученика (синхронизируйте каталог голосов).');
    wav = (await synthesizeWithVoice(text, cat[0], { userId: user.userId, operation: 'voice_smoke_learner' })).bytes;
  } else {
    const v = (await listServiceVoices()).find((x) => x.available);
    if (!v) throw new Error('Нет голоса для синтетического ученика.');
    wav = (await serviceTts(v.id, text, 'normal')).wav;
  }
  const info = parseWav(wav)!;
  const pcm = pcmSamples(wav, info);
  if (info.sampleRate === 16000) return pcm;
  const o = new Int16Array(Math.floor((pcm.length * 16000) / info.sampleRate));
  for (let i = 0; i < o.length; i++) { const x = (i * info.sampleRate) / 16000; const k = Math.floor(x); const f = x - k; o[i] = Math.round((pcm[k] ?? 0) * (1 - f) + (pcm[k + 1] ?? pcm[k] ?? 0) * f); }
  return o;
}

class Client {
  ws: WebSocket;
  msgs: ServerMessage[] = [];
  chunks: Array<{ turn_id: string; at: number }> = [];
  constructor(url: string, private onChunk: (turnId: string) => void) {
    this.ws = new WebSocket(`${url}${GATEWAY_PATH}`, { headers: { origin: new URL(env.appUrl).origin } });
    this.ws.on('message', (d, bin) => {
      if (bin) { const t = decodeAudioChunk(new Uint8Array(d as Buffer)).header.turn_id; this.chunks.push({ turn_id: t, at: Date.now() }); this.onChunk(t); } else this.msgs.push(JSON.parse(d.toString()));
    });
  }
  open() { return new Promise<void>((res, rej) => { this.ws.once('open', () => res()); this.ws.once('error', rej); }); }
  send(m: Record<string, unknown>) { this.ws.send(JSON.stringify(m)); }
  async waitFor<T extends ServerMessage['type']>(type: T, pred: (m: Extract<ServerMessage, { type: T }>) => boolean = () => true, timeoutMs = 120_000) {
    const t0 = Date.now();
    for (;;) {
      const hit = this.msgs.find((m) => m.type === type && pred(m as Extract<ServerMessage, { type: T }>));
      if (hit) return hit as Extract<ServerMessage, { type: T }>;
      const err = this.msgs.find((m) => m.type === 'error');
      if (err && type !== 'error') throw new Error(`gateway error: ${JSON.stringify(err)}`);
      if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${type}; got ${this.msgs.map((m) => m.type).join(',')}`);
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  async speak(pcm: Int16Array, leadMs = 400, tailMs = 2000) {
    const silence = (ms: number) => new Int16Array((16 * ms) | 0).map(() => Math.round((Math.random() - 0.5) * 40));
    const all = new Int16Array(silence(leadMs).length + pcm.length + silence(tailMs).length);
    all.set(silence(leadMs), 0); all.set(pcm, silence(leadMs).length); all.set(silence(tailMs), silence(leadMs).length + pcm.length);
    const step = FRAME_SAMPLES * 2;
    const t0 = Date.now();
    for (let o = 0, k = 0; o < all.length; o += step, k++) {
      this.ws.send(Buffer.from(all.slice(o, o + step).buffer));
      const wait = t0 + (k + 1) * 40 - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
  }
}

async function main() {
  if (!process.env.VOICE_GATEWAY_SECRET) throw new Error('VOICE_GATEWAY_SECRET is required (the same as the gateway).');
  const health = await fetch(`${gateway.replace(/^ws/, 'http')}/health`).then((r) => r.json()).catch((e) => ({ error: String(e) }));
  console.log('gateway health:', JSON.stringify(health));
  const db = adminClient();
  const email = `synthetic-voice-smoke-${randomUUID().slice(0, 8)}@greekos.test`;
  const { data, error } = await db.auth.admin.createUser({ email, password: randomBytes(18).toString('base64url'), email_confirm: true });
  if (error) throw error;
  const id = data.user.id;
  const profile = { user_id: id, display_name: 'Voice smoke (synthetic)', email, timezone: 'Europe/Athens', active: true, entry_path: 'from_zero', lifecycle_state: 'studying', invited_at: null, activated_at: null };
  // A test account: the gateway accepts synthetic speech only from such accounts outside local/test.
  await db.from('profiles').insert({ ...profile, account_kind: 'dev_preview_tester' });
  await db.from('role_assignments').insert({ user_id: id, role: 'owner_admin' });
  await db.from('enrollments').insert({ user_id: id, start_date: new Date().toISOString().slice(0, 10), timezone: 'Europe/Athens' });
  const user = { userId: id, email, isOwner: true, devPreview: false, profile } as SessionUser;
  const rows: Array<Record<string, unknown>> = [];
  const checks: Record<string, boolean> = {};
  try {
    const v = await startSession(user, { scenario_id: 'SC05', mode: 'roleplay', input_mode: 'voice', idempotency_key: randomUUID(), voice_persona: 'TUTOR_F', transport: 'stream_local_gateway' });
    // Like the browser: playback of a reply starts with its first audio chunk (whenever it arrives).
    const started = new Set<string>();
    const c = new Client(gateway, (turnId) => { if (!started.has(turnId)) { started.add(turnId); c.send({ type: 'playback', turn_id: turnId, event: 'started' }); } });
    await c.open();
    c.send({ type: 'auth', token: mintStreamToken(process.env.VOICE_GATEWAY_SECRET!, id, v.session_id), input_source: 'synthetic_test_clip' });
    const ready = await c.waitFor('ready');
    console.log('ready:', JSON.stringify({ persona: ready.persona, asr: ready.asr }));
    c.send({ type: 'listen', mic_ready_ms: 100 });
    await c.waitFor('state', (m) => m.state === 'listening');
    const seen = new Set<string>();
    for (let t = 0; t < Math.min(turns, LINES.length); t++) {
      const line = LINES[t];
      const pcm = await learnerClip(line, user);
      const before = c.msgs.length;
      await c.speak(pcm);
      const fin = await c.waitFor('final', (m) => !seen.has(m.utterance_id));
      seen.add(fin.utterance_id);
      if (fin.needs_confirmation) c.send({ type: 'confirm', utterance_id: fin.utterance_id, text: fin.text, edited: false });
      const start = await c.waitFor('assistant_start', (m) => c.msgs.indexOf(m) >= before);
      if (t === 1) {
        // Barge-in: the learner interrupts after ~0.6 s of the reply.
        await new Promise((r) => setTimeout(r, 600));
        c.send({ type: 'interrupt', turn_id: start.turn_id, heard_ms: 600 });
        checks.barge_in = true;
      }
      await c.waitFor('assistant_end', (m) => m.turn_id === start.turn_id).catch(() => null);
      c.send({ type: 'playback', turn_id: start.turn_id, event: 'ended' });
      const m = (await c.waitFor('metrics', (x) => c.msgs.indexOf(x) >= before)).metrics as Record<string, number | boolean | null>;
      rows.push({ learner: line, recognized: fin.text, needs_confirmation: fin.needs_confirmation ?? false, reply: start.sentences.join(' '), audio_chunks: c.chunks.filter((k) => k.turn_id === start.turn_id).length, ...m });
      console.log(`turn ${t + 1}: EOS→audio ${m.end_of_speech_to_audio_ms} ms | ${line} → «${fin.text}» → «${start.sentences.join(' ')}»`);
      await new Promise((r) => setTimeout(r, 800));
    }
    c.ws.close();
    const ended = await endSession(user, v.session_id).catch((e) => ({ error: String(e) }));
    checks.summary = !!(ended as { summary?: unknown }).summary;
    const { data: stored } = await db.from('speaking_turns').select('speaker').eq('session_id', v.session_id);
    checks.turns_saved = (stored ?? []).filter((x) => x.speaker === 'learner').length >= rows.length;
    checks.every_turn_voiced = rows.every((r) => Number(r.audio_chunks) > 0);
  } finally {
    await db.auth.admin.deleteUser(id);
  }
  const series = rows.map((r) => Number(r.end_of_speech_to_audio_ms)).filter((x) => Number.isFinite(x) && x > 0);
  const report = { gateway, at: new Date().toISOString(), gateway_providers: (health as { providers?: unknown }).providers ?? null, end_of_speech_to_audio_ms: { p50: pct(series, 0.5), p95: pct(series, 0.95), n: series.length }, checks, rows };
  mkdirSync(out, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  writeFileSync(`${out}/VOICE_SMOKE_${stamp}.json`, JSON.stringify(report, null, 1));
  console.log(JSON.stringify({ end_of_speech_to_audio_ms: report.end_of_speech_to_audio_ms, checks }, null, 1));
  if (!Object.values(checks).every(Boolean) || !rows.length) process.exit(2);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
