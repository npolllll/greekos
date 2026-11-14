/**
 * Applies the AI editor's recorded decisions to production (run by «GreekOS review»):
 *   sample-show            the release sample of the latest full QA batch → reports/review/sample.json
 *   apply                  reports/review/decisions/{voices,listening,sample}.json, then the delegated
 *                          release (only under an owner-signed policy that delegates it)
 * Every write is the AI editor's (system actor); nothing is signed, nothing is attributed to the owner.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { applyVoiceDecisions, currentSample, editorialAudioRelease, editorialRelease, recordAiSampleReviews, recordEditorialListening, refreshAssetCastApproval, type AiSampleReview, type CastDecision, type ListeningVerdict, type VoiceDecision } from '../../src/lib/qa/editorial.ts';

const DIR = 'reports/review';
const read = <T,>(name: string): T | null => (existsSync(`${DIR}/decisions/${name}.json`) ? JSON.parse(readFileSync(`${DIR}/decisions/${name}.json`, 'utf8')) as T : null);
mkdirSync(DIR, { recursive: true });
const cmd = process.argv[2];
if (cmd === 'sample-show') {
  const s = await currentSample();
  writeFileSync(`${DIR}/sample.json`, JSON.stringify(s, null, 1));
  console.log(JSON.stringify({ batch_id: s?.batch_id, releasable: s?.releasable, sample: s?.sample.length }));
} else if (cmd === 'apply') {
  const out: Record<string, unknown> = {};
  const voices = read<{ voices: VoiceDecision[]; cast: CastDecision[] }>('voices');
  if (voices) out.voices = await applyVoiceDecisions(voices.voices, voices.cast);
  else out.cast_refresh = await refreshAssetCastApproval();
  const listening = read<ListeningVerdict[]>('listening');
  if (listening) out.listening = await recordEditorialListening(listening);
  const sample = read<{ batch_id: string; reviews: AiSampleReview[] }>('sample');
  if (sample) out.sample = await recordAiSampleReviews(sample.batch_id, sample.reviews);
  out.release = await editorialRelease();
  out.audio_release = await editorialAudioRelease();
  writeFileSync(`${DIR}/apply-result.json`, JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
} else {
  console.error('usage: editorial-apply.ts sample-show | apply');
  process.exit(2);
}
process.exit(0);
