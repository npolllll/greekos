/**
 * Utterance-level ASR for the streaming voice gateway. The gateway does the endpointing (VAD);
 * this adapter turns the growing utterance buffer into partial and final transcripts.
 *
 * - local: the development Whisper service; partials are produced by re-decoding the growing
 *   buffer with the small model (real recognition, labelled as partial, never as confirmed).
 * - openai / azure: final transcript via the provider's REST endpoint (configured keys only).
 *   These REST endpoints do not emit partial events, so `partials` is false — the UI then shows
 *   "Распознаю…" without inventing interim text. Native streaming recognisers (Azure Speech SDK
 *   continuous recognition, OpenAI Realtime transcription) plug in behind the same interface.
 * - mock: synthetic marker for automated tests only; refused unless synthetic providers are allowed.
 */
import { env } from '../env.ts';
import { buildWav } from '../audio/wav.ts';
import { greekLetterRatio } from '../scoring/normalize.ts';
import { localTranscribe } from './local-engines.ts';
import { asrStatus, transcribe, ProviderUnavailableError } from './speech.ts';
import { recordUsage } from './budget.ts';

export interface UtteranceTranscript {
  text: string;
  confidence: number | null;      // provider-reported decoding confidence, not pronunciation quality
  noSpeechProb: number | null;
  provider: string;
  model: string;
  elapsedMs: number;
  synthetic: boolean;
}

export interface UtteranceAsr {
  readonly provider: string;
  readonly partials: boolean;
  readonly nativeStreaming: boolean;
  partial(pcm: Int16Array, sampleRate: number): Promise<string | null>;
  final(pcm: Int16Array, sampleRate: number, userId: string): Promise<UtteranceTranscript>;
}

/** Token budget proportional to audio length: generous for real speech, fatal for repetition loops. */
const tokenCap = (samples: number, sampleRate: number, base: number, perSecond: number) => Math.min(440, Math.round(base + perSecond * (samples / sampleRate)));

const localAdapter = (finalModel: 'small' | 'medium'): UtteranceAsr => ({
  provider: 'local',
  partials: true,
  nativeStreaming: false,
  async partial(pcm, sampleRate) {
    const r = await localTranscribe(buildWav(pcm, sampleRate), 'small', 8_000, tokenCap(pcm.length, sampleRate, 12, 12));
    return r.text.trim() || null;
  },
  async final(pcm, sampleRate, userId) {
    const t0 = Date.now();
    const r = await localTranscribe(buildWav(pcm, sampleRate), finalModel, 30_000, tokenCap(pcm.length, sampleRate, 32, 20));
    const elapsedMs = Date.now() - t0;
    await recordUsage({ userId, provider: 'local', operation: 'asr_stream_final', units: pcm.length / sampleRate, unitKind: 'seconds', costUsd: 0, ok: true, latencyMs: elapsedMs }).catch(() => undefined);
    return { text: r.text.trim(), confidence: r.confidence, noSpeechProb: r.no_speech_prob, provider: 'local', model: `${r.engine}:${r.model}`, elapsedMs, synthetic: false };
  },
});

const restAdapter = (provider: string): UtteranceAsr => ({
  provider,
  partials: false,
  nativeStreaming: false,
  async partial() {
    return null;
  },
  async final(pcm, sampleRate, userId) {
    const t0 = Date.now();
    const r = await transcribe(buildWav(pcm, sampleRate), userId);
    return { text: r.text, confidence: r.confidence, noSpeechProb: null, provider: r.provider, model: r.model, elapsedMs: Date.now() - t0, synthetic: r.synthetic };
  },
});

export function utteranceAsr(): UtteranceAsr {
  const st = asrStatus();
  if (!st.configured) throw new ProviderUnavailableError('Распознавание речи не подключено.');
  if (st.provider === 'local') return localAdapter(process.env.LOCAL_ASR_STREAM_FINAL_MODEL === 'medium' ? 'medium' : 'small');
  if (st.provider === 'mock' && !env.allowSyntheticProviders) throw new ProviderUnavailableError('Синтетический ASR запрещён в этой среде.');
  return restAdapter(st.provider);
}

export type ConfirmReason = 'low_confidence' | 'no_confidence' | 'possible_silence' | 'not_greek' | 'noisy_audio' | 'synthetic';

/** Below this speech-to-noise ratio Whisper's confidence does not catch misrecognitions (measured: voice bench, noisy class). */
export const MIN_CONFIDENT_SNR_DB = 18;

/**
 * When the transcript must be shown as «Это вы сказали?» before it is used. Uncertain recognition
 * never penalises the learner: it is confirmed, corrected or re-recorded first (v5.4 §6).
 */
export function confirmationReason(t: UtteranceTranscript, audio: { snrDb?: number | null } = {}): ConfirmReason | null {
  if (t.synthetic) return 'synthetic';
  if (t.noSpeechProb != null && t.noSpeechProb > 0.6) return 'possible_silence';
  if (t.confidence == null) return 'no_confidence';
  if (t.confidence < 0.45) return 'low_confidence';
  if (t.text && greekLetterRatio(t.text) < 0.5) return 'not_greek';
  if (audio.snrDb != null && audio.snrDb < MIN_CONFIDENT_SNR_DB) return 'noisy_audio';
  return null;
}
