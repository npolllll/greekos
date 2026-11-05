import { makeUser, saveState, seedSyntheticUnit } from './fixtures';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { VOICE_CLIP } from '../../playwright.config';

const PHRASE = 'Θέλω ένα κιλό μήλα. Πόσο κάνουν;';

function writeClip(pcm16k: Buffer) {
  const pad = (s: number) => Buffer.alloc(16000 * 2 * s);
  const data = Buffer.concat([pad(1), pcm16k, pad(5)]);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  writeFileSync(VOICE_CLIP, Buffer.concat([h, data]));
}

/** Linux: the same phrase from the GreekOS local speech service (Coqui voice), resampled to 16 kHz. */
async function makeServiceClip() {
  const base = process.env.LOCAL_ASR_URL ?? 'http://127.0.0.1:3312';
  try {
    const r = await fetch(`${base}/tts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ voice: 'coqui-el-css10', text: PHRASE }), signal: AbortSignal.timeout(120_000) });
    if (!r.ok) return;
    const b = Buffer.from(await r.arrayBuffer());
    const rate = b.readUInt32LE(24);
    let off = 12;
    while (off + 8 <= b.length && b.toString('ascii', off, off + 4) !== 'data') off += 8 + b.readUInt32LE(off + 4);
    const src = new Int16Array(b.buffer.slice(b.byteOffset + off + 8, b.byteOffset + off + 8 + b.readUInt32LE(off + 4)));
    const out = Buffer.alloc(Math.floor((src.length * 16000) / rate) * 2);
    for (let i = 0; i < out.length / 2; i++) {
      const x = (i * rate) / 16000, k = Math.floor(x), f = x - k;
      out.writeInt16LE(Math.round((src[k] ?? 0) * (1 - f) + (src[k + 1] ?? src[k] ?? 0) * f), i * 2);
    }
    mkdirSync(dirname(VOICE_CLIP), { recursive: true });
    writeClip(out);
  } catch { /* no local speech service: the voice E2E is skipped with a reason */ }
}

/** Learner phrase for the live voice E2E: 1 s silence + Greek phrase + 5 s silence (16 kHz mono). */
async function makeVoiceClip() {
  if (process.platform !== 'darwin') return makeServiceClip();
  mkdirSync(dirname(VOICE_CLIP), { recursive: true });
  const raw = `${VOICE_CLIP}.raw.wav`;
  try {
    execFileSync('say', ['-v', 'Melina', '-o', raw, '--file-format=WAVE', '--data-format=LEI16@16000', PHRASE]);
  } catch {
    return;
  }
  const b = readFileSync(raw);
  let off = 12;
  while (off + 8 <= b.length && b.toString('ascii', off, off + 4) !== 'data') off += 8 + b.readUInt32LE(off + 4);
  writeClip(b.subarray(off + 8, off + 8 + b.readUInt32LE(off + 4)));
  rmSync(raw, { force: true });
}

export default async function globalSetup() {
  await makeVoiceClip();
  await seedSyntheticUnit();
  const [owner, learner, learner2] = await Promise.all([makeUser('owner_admin', false), makeUser('learner', true), makeUser('learner', false)]);
  saveState({ owner, learner, learner2 });
}
