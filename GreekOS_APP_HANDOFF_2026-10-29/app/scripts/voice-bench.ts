/**
 * Live speaking latency + ASR robustness bench through the REAL streaming gateway, local DB,
 * local Whisper and the local Greek voice. Learner speech = synthetic clips of the scenarios'
 * own acceptable answers, streamed in real time, in three classes (v5.4 §6):
 *   a) clean, b) quiet (−20 dB) + continuous background noise (SNR ≈ 15 dB), c) hesitant: 800 ms pauses.
 * Everything is labelled synthetic_test_clip. Live learner utterances (R01) are NOT covered.
 *
 *   npx tsx --conditions=react-server scripts/voice-bench.ts --out reports/v5.4 [--sessions 3]
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { cpus, platform, release } from 'node:os';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
process.env.APP_ENV ??= 'local';

const { default: WebSocket } = await import('ws');
const { adminClient } = await import('../src/lib/supabase/admin.ts');
const { startVoiceGateway } = await import('../src/lib/speaking/gateway.ts');
const { mintStreamToken } = await import('../src/lib/speaking/stream-token.ts');
const { decodeAudioChunk, GATEWAY_PATH } = await import('../src/lib/speaking/stream-protocol.ts');
const { startSession } = await import('../src/lib/speaking/service.ts');
const { loadSessionUser } = await import('../src/lib/session-user.ts');
const { listLocalGreekVoices, sayToWav, localAsrHealth } = await import('../src/lib/providers/local-engines.ts');
const { parseWav, pcmSamples } = await import('../src/lib/audio/wav.ts');
const { roundTrip, alignmentDiff } = await import('../src/lib/audio/roundtrip.ts');

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const outDir = resolve(arg('--out') ?? 'reports/v5.4');
const sessionsWanted = Number(arg('--sessions') ?? '3');
const db = adminClient();

type Msg = Record<string, unknown> & { type: string };
const pct = (v: number[], p: number) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] : null; };

async function main() {
  if (!(await localAsrHealth())) throw new Error('локальный ASR-сервис не запущен (npm run local:asr)');
  const voice = (await listLocalGreekVoices())[0];
  if (!voice) throw new Error('нет локального греческого голоса');
  const gw = await startVoiceGateway({ port: 0 });
  const email = `synthetic-bench-${randomUUID().slice(0, 6)}@greekos.test`;
  const { data: created, error } = await db.auth.admin.createUser({ email, password: randomBytes(18).toString('base64url'), email_confirm: true });
  if (error) throw error;
  const uid = created.user.id;
  await db.from('profiles').insert({ user_id: uid, display_name: 'Voice bench (synthetic)', email, timezone: 'Europe/Athens', active: true, lifecycle_state: 'studying', entry_path: 'from_zero' });
  await db.from('role_assignments').insert({ user_id: uid, role: 'owner_admin' });
  const user = (await loadSessionUser(uid))!;
  const turns: Array<Record<string, unknown>> = [];
  try {
    const { data: scs } = await db.from('speaking_scenarios').select('scenario_id, level, payload').in('level', ['A1', 'A2', 'B1', 'B2']).order('scenario_id');
    const picked = (scs ?? []).filter((s) => !String(s.scenario_id).startsWith('RG-')).filter((s, i, a) => a.findIndex((x) => x.level === s.level) === i).slice(0, sessionsWanted);
    for (const sc of picked) {
      for (const cls of ['clean', 'quiet_noise', 'hesitant'] as const) {
        const v = await startSession(user, { scenario_id: sc.scenario_id, mode: 'roleplay', input_mode: 'voice', idempotency_key: randomUUID(), voice_persona: 'TUTOR_F', transport: 'stream_local_gateway' });
        const nodes = (sc.payload as { nodes: Array<{ node_id: string; acceptable_examples_el?: string[] }> }).nodes;
        const phrases = nodes.flatMap((n) => n.acceptable_examples_el?.slice(0, 1) ?? []).slice(0, 3);
        const ws = new WebSocket(`ws://127.0.0.1:${gw.port}${GATEWAY_PATH}`);
        const msgs: Msg[] = [];
        const firstChunkAt = new Map<string, number>();
        ws.on('message', (d, bin) => {
          if (bin) { const { header } = decodeAudioChunk(new Uint8Array(d as Buffer)); if (!firstChunkAt.has(header.turn_id)) { firstChunkAt.set(header.turn_id, Date.now()); ws.send(JSON.stringify({ type: 'playback', turn_id: header.turn_id, event: 'started' })); } }
          else msgs.push(JSON.parse(d.toString()));
        });
        await new Promise((r) => ws.once('open', r));
        ws.send(JSON.stringify({ type: 'auth', token: mintStreamToken(process.env.VOICE_GATEWAY_SECRET!, uid, v.session_id), input_source: 'synthetic_test_clip' }));
        await waitFor(msgs, (m) => m.type === 'ready');
        ws.send(JSON.stringify({ type: 'listen', mic_ready_ms: 0 }));
        for (const [k, phrase] of phrases.entries()) {
          const pcm = await clip(phrase, voice.id, cls);
          const before = msgs.length;
          const speechEndWall = await stream(ws, pcm.samples, pcm.speechEndSample, pcm.noiseAmp);
          const fin = await waitFor(msgs, (m) => m.type === 'final', before, 60_000);
          const finals = msgs.slice(before).filter((m) => m.type === 'final');
          if (fin.needs_confirmation) ws.send(JSON.stringify({ type: 'confirm', utterance_id: fin.utterance_id, text: fin.text, edited: false }));
          let start: Msg | null = null;
          try { start = await waitFor(msgs, (m) => m.type === 'assistant_start', before, 60_000); } catch { /* no reply */ }
          if (start) {
            await waitFor(msgs, (m) => m.type === 'assistant_end' && m.turn_id === start!.turn_id, before, 60_000);
            ws.send(JSON.stringify({ type: 'playback', turn_id: start.turn_id, event: 'ended' }));
          }
          const met = await waitFor(msgs, (m) => m.type === 'metrics', before, 15_000).catch(() => null);
          const rt = fin.text ? roundTrip(phrase, String(fin.text)) : null;
          turns.push({
            scenario: sc.scenario_id, level: sc.level, class: cls, turn: k + 1, reference: phrase, transcript: fin.text, confidence: fin.confidence,
            needs_confirmation: fin.needs_confirmation, confirm_reason: fin.reason, split_into_finals: finals.length, wer: rt?.wer ?? null, cer: rt?.cer_accent_insensitive ?? null,
            accent_mismatches: rt?.accent_mismatches ?? [], diff: fin.text ? alignmentDiff(phrase, String(fin.text)) : null,
            client_end_of_speech_to_first_chunk_ms: start ? firstChunkAt.get(String(start.turn_id))! - speechEndWall : null,
            gateway: met?.metrics ?? null,
          });
          process.stderr.write(`${sc.scenario_id} ${cls} #${k + 1}: «${fin.text}» ${start ? `${firstChunkAt.get(String(start.turn_id))! - speechEndWall} ms` : 'no reply'}\n`);
        }
        ws.close();
      }
    }
  } finally {
    await gw.close();
    await db.auth.admin.deleteUser(uid);
  }
  const byClass = (c: string) => turns.filter((t) => t.class === c);
  const lat = (rows: Array<Record<string, unknown>>, key: string) => rows.map((t) => (t.gateway as Record<string, number> | null)?.[key]).filter((x): x is number => typeof x === 'number');
  const total = turns.map((t) => t.client_end_of_speech_to_first_chunk_ms).filter((x): x is number => typeof x === 'number');
  const report = {
    generated_at: new Date().toISOString(),
    label: 'SYNTHETIC_TEST_CLIPS — local engines; not live learner speech; cloud providers NOT_TESTED',
    environment: { platform: `${platform()} ${release()}`, cpus: cpus()[0]?.model, cores: cpus().length, asr: 'local openai-whisper small (stream final)', tts: `local macOS ${voice.name} (${voice.quality ?? 'n/a'})`, dialogue: 'scripted_fallback (LLM not connected)', transport: 'local WebSocket gateway' },
    slo_pilot: { p50_ms: 1500, p95_ms: 3500, definition: 'end of learner speech → first audible AI audio' },
    turns: turns.length,
    end_of_speech_to_first_audio_ms: { p50: pct(total, 0.5), p95: pct(total, 0.95), max: total.length ? Math.max(...total) : null, note: 'client-side: last voiced sample sent → first audio chunk received (+ ~50 ms browser scheduling not included)' },
    components_ms: Object.fromEntries(['vad_hangover_ms', 'asr_final_ms', 'dialogue_ms', 'tts_first_audio_ms', 'end_of_speech_to_audio_ms'].map((k) => [k, { p50: pct(lat(turns, k), 0.5), p95: pct(lat(turns, k), 0.95) }])),
    by_class: Object.fromEntries(['clean', 'quiet_noise', 'hesitant'].map((c) => {
      const rows = byClass(c);
      const t = rows.map((r) => r.client_end_of_speech_to_first_chunk_ms).filter((x): x is number => typeof x === 'number');
      const w = rows.map((r) => r.wer).filter((x): x is number => typeof x === 'number');
      return [c, { turns: rows.length, latency_p50: pct(t, 0.5), latency_p95: pct(t, 0.95), wer_mean: w.length ? Number((w.reduce((a, b) => a + b, 0) / w.length).toFixed(3)) : null, needs_confirmation: rows.filter((r) => r.needs_confirmation).length, split_utterances: rows.filter((r) => Number(r.split_into_finals) > 1).length }];
    })),
    rows: turns,
  };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'LIVE_SPEAKING_LATENCY.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ out: outDir, turns: turns.length, end_of_speech_to_first_audio_ms: report.end_of_speech_to_first_audio_ms, components_ms: report.components_ms, by_class: report.by_class }, null, 2));
}

async function waitFor(msgs: Msg[], pred: (m: Msg) => boolean, from = 0, timeoutMs = 30_000): Promise<Msg> {
  const t0 = Date.now();
  for (;;) {
    const hit = msgs.slice(from).find(pred);
    if (hit) return hit;
    const err = msgs.slice(from).find((m) => m.type === 'error');
    if (err) throw new Error(`gateway: ${JSON.stringify(err)}`);
    if (Date.now() - t0 > timeoutMs) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Synthetic learner clip at 16 kHz with the class transformation applied. */
async function clip(text: string, voiceId: string, cls: 'clean' | 'quiet_noise' | 'hesitant') {
  const parts = cls === 'hesitant' ? text.split(/(?<=[,.;])\s+/).filter(Boolean) : [text];
  const segs: Int16Array[] = [];
  for (const [i, p] of parts.entries()) {
    const w = await sayToWav(p, voiceId, 1, 16000);
    segs.push(pcmSamples(w, parseWav(w)!));
    if (i < parts.length - 1) segs.push(new Int16Array(16 * 800)); // 800 ms hesitation pause
  }
  const n = segs.reduce((a, s) => a + s.length, 0);
  const out = new Int16Array(n);
  let o = 0;
  for (const s of segs) { out.set(s, o); o += s.length; }
  let last = out.length - 1;
  while (last > 0 && Math.abs(out[last]) < 300) last--;
  let noiseAmp = 30; // quiet room
  if (cls === 'quiet_noise') {
    let e = 0;
    for (const v of out) e += v * v;
    const rms = Math.sqrt(e / Math.max(1, out.length)) * 0.1; // −20 dB speech
    noiseAmp = rms * 0.18 * Math.sqrt(3); // continuous background noise, SNR ≈ 15 dB
    for (let i = 0; i < out.length; i++) out[i] = Math.round(out[i] * 0.1 + (Math.random() - 0.5) * 2 * noiseAmp);
  }
  return { samples: out, speechEndSample: last, noiseAmp };
}

/** Streams 400 ms lead-in, the clip and 3 s of room tone in 40 ms packets at real-time pace. */
async function stream(ws: InstanceType<typeof WebSocket>, pcm: Int16Array, speechEndSample: number, noiseAmp = 30): Promise<number> {
  const room = (ms: number) => new Int16Array(16 * ms).map(() => Math.round((Math.random() - 0.5) * 2 * noiseAmp));
  const lead = room(400);
  const all = new Int16Array(lead.length + pcm.length + 16 * 3000);
  all.set(lead, 0); all.set(pcm, lead.length); all.set(room(3000), lead.length + pcm.length);
  const endIdx = lead.length + speechEndSample;
  const step = 640;
  const t0 = Date.now();
  let speechEndWall = 0;
  for (let o = 0, k = 0; o < all.length; o += step, k++) {
    ws.send(Buffer.from(all.slice(o, o + step).buffer));
    if (!speechEndWall && o + step >= endIdx) speechEndWall = Date.now();
    const wait = t0 + (k + 1) * 40 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  return speechEndWall;
}

await main();
process.exit(0);
