import { makeUser, saveState, seedSyntheticUnit } from './fixtures';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { VOICE_CLIP } from '../../playwright.config';

/** Learner phrase for the live voice E2E: 1 s silence + Greek phrase + 5 s silence (16 kHz mono). */
function makeVoiceClip() {
  if (process.platform !== 'darwin') return;
  mkdirSync(dirname(VOICE_CLIP), { recursive: true });
  const raw = `${VOICE_CLIP}.raw.wav`;
  try {
    execFileSync('say', ['-v', 'Melina', '-o', raw, '--file-format=WAVE', '--data-format=LEI16@16000', 'Θέλω ένα κιλό μήλα. Πόσο κάνουν;']);
  } catch {
    return;
  }
  const b = readFileSync(raw);
  let off = 12;
  while (off + 8 <= b.length && b.toString('ascii', off, off + 4) !== 'data') off += 8 + b.readUInt32LE(off + 4);
  const pcm = b.subarray(off + 8, off + 8 + b.readUInt32LE(off + 4));
  const pad = (s: number) => Buffer.alloc(16000 * 2 * s);
  const data = Buffer.concat([pad(1), pcm, pad(5)]);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  writeFileSync(VOICE_CLIP, Buffer.concat([h, data]));
  rmSync(raw, { force: true });
}

export default async function globalSetup() {
  makeVoiceClip();
  await seedSyntheticUnit();
  const [owner, learner, learner2] = await Promise.all([makeUser('owner_admin', false), makeUser('learner', true), makeUser('learner', false)]);
  saveState({ owner, learner, learner2 });
}
