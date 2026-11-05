import { createHash } from 'node:crypto';
import { adminClient } from '../supabase/admin.ts';
import { synthesizeWithVoice } from '../providers/speech.ts';
import { analyzeWav } from '../audio/wav.ts';
import type { CatalogVoice } from './catalog.ts';

/** Audition text: stress, question intonation, names/places and an abbreviation (v5.4 §3). */
export const AUDITION_TEXT = 'Καλημέρα σας! Θα πάμε αύριο στη Θεσσαλονίκη ή στην Αθήνα; Ο ΠΑΟΚ παίζει απόψε. Μπορείτε να το πείτε λίγο πιο αργά, παρακαλώ;';

export async function renderVoiceSample(voice: CatalogVoice, actorId: string | null) {
  const db = adminClient();
  const audio = await synthesizeWithVoice(AUDITION_TEXT, voice, { speed: 'normal', userId: actorId, operation: 'tts_voice_sample' });
  const tech = analyzeWav(audio.bytes);
  const sha = createHash('sha256').update(audio.bytes).digest('hex');
  const path = `voice-samples/${voice.voice_id.replace(/[^A-Za-z0-9._-]/g, '_')}/${sha}.wav`;
  const up = await db.storage.from('tts-cache').upload(path, audio.bytes, { contentType: 'audio/wav', upsert: true });
  if (up.error) throw new Error(up.error.message);
  await db.from('voice_catalog').update({ sample_object_path: path, sample_sha256: sha, qa_status: tech?.pass ? 'TECH_QA_PASS' : 'TECH_QA_FAIL' }).eq('voice_id', voice.voice_id);
  return { path, sha, technical: tech };
}
