/**
 * Full-path latency of the live voice conversation on this machine (mandate §5.5): end of the learner's
 * speech → first audible reply, through the real voice gateway — VAD, ASR (Whisper), the dialogue
 * model, sentence-by-sentence TTS and the stream to the client. The learner is a synthetic Greek clip
 * (local voice) streamed in real time; the client reports playback as soon as the first audio chunk
 * arrives, as the browser does. Each turn's components come from the gateway's own metrics.
 *
 *   npx tsx --conditions=react-server scripts/voice-latency.ts [--scenario SC05] [--out reports/v8/voice-latency]
 *
 * Uses a temporary synthetic account (deleted at the end); writes nothing to course content.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import WebSocket from 'ws';
import { adminClient } from '../src/lib/supabase/admin.ts';
import { env } from '../src/lib/env.ts';
import type { SessionUser } from '../src/lib/session-user.ts';
import { startVoiceGateway } from '../src/lib/speaking/gateway.ts';
import { mintStreamToken } from '../src/lib/speaking/stream-token.ts';
import { decodeAudioChunk, GATEWAY_PATH, FRAME_SAMPLES, type ServerMessage } from '../src/lib/speaking/stream-protocol.ts';
import { startSession, endSession } from '../src/lib/speaking/service.ts';
import { localAsrHealth, listServiceVoices, serviceTts } from '../src/lib/providers/local-engines.ts';
import { parseWav, pcmSamples } from '../src/lib/audio/wav.ts';
import { llmInfo } from '../src/lib/providers/llm.ts';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const scenario = arg('--scenario', 'SC05');
const out = arg('--out', 'reports/v8/voice-latency');
const LINES: Record<string, string[]> = {
  SC05: ['Θέλω ένα καφέ, παρακαλώ.', 'Ναι, μεγάλο, ευχαριστώ.', 'Θα μείνω εδώ.', 'Πόσο κάνει;', 'Ευχαριστώ πολύ!'],
  SC01: ['Καλημέρα. Θέλω ένα κιλό μήλα.', 'Μισό κιλό αχλάδια, παρακαλώ.', 'Πόσο κάνουν όλα μαζί;', 'Ορίστε. Ευχαριστώ!'],
};
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };

class Client {
  ws: WebSocket;
  msgs: ServerMessage[] = [];
  constructor(port: number, private onChunk: (turnId: string) => void) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}${GATEWAY_PATH}`);
    this.ws.on('message', (d, bin) => {
      if (bin) this.onChunk(decodeAudioChunk(new Uint8Array(d as Buffer)).header.turn_id);
      else this.msgs.push(JSON.parse(d.toString()));
    });
  }
  open() { return new Promise<void>((res, rej) => { this.ws.once('open', () => res()); this.ws.once('error', rej); }); }
  send(m: Record<string, unknown>) { this.ws.send(JSON.stringify(m)); }
  async waitFor<T extends ServerMessage['type']>(type: T, pred: (m: Extract<ServerMessage, { type: T }>) => boolean = () => true, timeoutMs = 120_000) {
    const t0 = Date.now();
    for (;;) {
      const hit = this.msgs.find((m) => m.type === type && pred(m as Extract<ServerMessage, { type: T }>));
      if (hit) return hit as Extract<ServerMessage, { type: T }>;
      if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${type}`);
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

async function clip(voice: string, text: string): Promise<Int16Array> {
  const wav = (await serviceTts(voice, text, 'normal')).wav;
  const info = parseWav(wav)!;
  const pcm = pcmSamples(wav, info);
  if (info.sampleRate === 16000) return pcm;
  const o = new Int16Array(Math.floor((pcm.length * 16000) / info.sampleRate));
  for (let i = 0; i < o.length; i++) { const x = (i * info.sampleRate) / 16000; const k = Math.floor(x); const f = x - k; o[i] = Math.round((pcm[k] ?? 0) * (1 - f) + (pcm[k + 1] ?? pcm[k] ?? 0) * f); }
  return o;
}

async function main() {
  if (env.appEnv !== 'local') throw new Error('Только локальная среда (APP_ENV=local).');
  if (!(await localAsrHealth())) throw new Error('Локальный речевой сервис не запущен (npm run local:speech).');
  const voice = (await listServiceVoices()).find((v) => v.available && v.id === 'coqui-el-css10')?.id;
  if (!voice) throw new Error('Нет локального греческого голоса для синтетического ученика.');
  const db = adminClient();
  const email = `voice-latency-${randomUUID().slice(0, 8)}@greekos.test`;
  const { data, error } = await db.auth.admin.createUser({ email, password: randomBytes(18).toString('base64url'), email_confirm: true });
  if (error) throw error;
  const id = data.user.id;
  await db.from('profiles').insert({ user_id: id, display_name: 'Voice latency probe', email, timezone: 'Europe/Athens', active: true, lifecycle_state: 'studying', entry_path: 'from_zero' });
  await db.from('role_assignments').insert({ user_id: id, role: 'owner_admin' });
  await db.from('enrollments').insert({ user_id: id, start_date: '2026-10-01', timezone: 'Europe/Athens' });
  const user = { userId: id, email, isOwner: true, devPreview: false, profile: { user_id: id, display_name: 'Voice latency probe', email, timezone: 'Europe/Athens', active: true, entry_path: 'from_zero', lifecycle_state: 'studying', invited_at: null, activated_at: null } } as SessionUser;
  const gw = await startVoiceGateway({ port: 0 });
  const rows: Array<Record<string, unknown>> = [];
  try {
    const v = await startSession(user, { scenario_id: scenario, mode: 'roleplay', input_mode: 'voice', idempotency_key: randomUUID(), voice_persona: 'TUTOR_F', transport: 'stream_local_gateway' });
    let current: string | null = null;
    let reported = false;
    // Like the browser: playback starts with the first audio chunk of the reply.
    const c = new Client(gw.port, (turnId) => { if (turnId === current && !reported) { reported = true; c.send({ type: 'playback', turn_id: turnId, event: 'started' }); } });
    await c.open();
    c.send({ type: 'auth', token: mintStreamToken(process.env.VOICE_GATEWAY_SECRET!, id, v.session_id), input_source: 'synthetic_test_clip' });
    await c.waitFor('ready');
    c.send({ type: 'listen', mic_ready_ms: 100 });
    await c.waitFor('state', (m) => m.state === 'listening');
    const seen = new Set<string>();
    for (const line of LINES[scenario] ?? LINES.SC05) {
      const pcm = await clip(voice, line);
      const before = c.msgs.length;
      await c.speak(pcm);
      const fin = await c.waitFor('final', (m) => !seen.has(m.utterance_id));
      seen.add(fin.utterance_id);
      if (fin.needs_confirmation) c.send({ type: 'confirm', utterance_id: fin.utterance_id, text: fin.text, edited: false });
      const start = await c.waitFor('assistant_start', (m) => c.msgs.indexOf(m) >= before);
      current = start.turn_id; reported = false;
      await c.waitFor('assistant_end', (m) => m.turn_id === start.turn_id);
      c.send({ type: 'playback', turn_id: start.turn_id, event: 'ended' });
      const m = (await c.waitFor('metrics', (x) => c.msgs.indexOf(x) >= before)).metrics as Record<string, number | null>;
      rows.push({ learner: line, recognized: fin.text, reply: start.sentences.join(' '), ...m });
      console.log(`EOS→audio ${m.end_of_speech_to_audio_ms} ms (ASR ${m.asr_final_ms}, LLM 1st ${m.llm_first_sentence_ms}, TTS 1st ${m.tts_first_audio_ms}) | ${line} → ${fin.text}`);
      await new Promise((r) => setTimeout(r, 800));
    }
    c.ws.close();
    await endSession(user, v.session_id).catch(() => null);
  } finally {
    await gw.close();
    await db.auth.admin.deleteUser(id);
  }
  const series = (k: string) => rows.map((r) => Number(r[k])).filter((x) => Number.isFinite(x) && x > 0);
  const stat = (k: string) => ({ p50: pct(series(k), 0.5), p95: pct(series(k), 0.95), n: series(k).length });
  const report = {
    method: 'end of learner speech (last voiced frame, VAD) → first audio chunk received and playback started by the client; synthetic learner clip streamed in real time through the local voice gateway',
    machine: { cpus: cpus().length, model: cpus()[0]?.model ?? null, platform: process.platform },
    llm: llmInfo(), scenario, turns: rows.length,
    end_of_speech_to_audio_ms: stat('end_of_speech_to_audio_ms'),
    components: { asr_final_ms: stat('asr_final_ms'), llm_first_sentence_ms: stat('llm_first_sentence_ms'), tts_first_audio_ms: stat('tts_first_audio_ms'), vad_hangover_ms: stat('vad_hangover_ms') },
    pilot_target: { p50_ms: 1500, p95_ms: 3500 },
    rows,
  };
  mkdirSync(out, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  writeFileSync(`${out}/VOICE_LATENCY_${scenario}_${stamp}.json`, JSON.stringify(report, null, 1));
  const e = report.end_of_speech_to_audio_ms;
  writeFileSync(`${out}/VOICE_LATENCY_${scenario}_${stamp}.md`, [
    `# Задержка живого разговора: конец речи → звук (${stamp})`, '',
    `Методика: ${report.method}.`, `Машина: ${report.machine.cpus} CPU (${report.machine.model ?? '—'}), ${report.machine.platform}; модель: ${report.llm.label_ru}.`, '',
    `| Метрика | p50 | p95 | n |`, `|---|---|---|---|`,
    `| **Конец речи → звук** | **${e.p50} мс** | **${e.p95} мс** | ${e.n} |`,
    ...Object.entries(report.components).map(([k, v]) => `| ${k} | ${v.p50} | ${v.p95} | ${v.n} |`), '',
    `Цель пилота: p50 ≤ 1500 мс, p95 ≤ 3500 мс — ${e.p50 != null && e.p95 != null && e.p50 <= 1500 && e.p95 <= 3500 ? 'достигнута' : 'не достигнута на этой машине'}.`, '',
    '| Реплика ученика | Распознано | Конец речи → звук, мс |', '|---|---|---|',
    ...rows.map((r) => `| ${r.learner} | ${r.recognized} | ${r.end_of_speech_to_audio_ms} |`),
  ].join('\n'));
  console.log(JSON.stringify({ end_of_speech_to_audio_ms: e, components: report.components }, null, 1));
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
