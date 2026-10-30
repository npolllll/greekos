/**
 * Provider-neutral speech adapters (server-only). Audio is processed in memory; nothing is
 * persisted here. Mock adapters are synthetic test transports and refuse to run in production.
 */
import { env } from '../env.ts';
import { assertBudget, COST, recordUsage } from './budget.ts';
import { buildWav, parseWav } from '../audio/wav.ts';
import { localTranscribe, sayToWav, localTtsSupported, serviceTts } from './local-engines.ts';
import type { CatalogVoice } from '../voice/catalog.ts';

export interface AsrResult {
  text: string;
  confidence: number | null; // provider-reported, NOT a probability of academic correctness
  provider: string;
  model: string;
  durationMs: number | null;
  synthetic: boolean;
}

export interface TtsResult {
  bytes: Uint8Array;
  mime: 'audio/wav';
  provider: string;
  model: string;
  voice: string;
  synthetic: true;
}

export class ProviderUnavailableError extends Error {
  readonly code = 'PROVIDER_UNAVAILABLE';
}

export function asrStatus(): { provider: string; configured: boolean; synthetic: boolean } {
  const p = env.asrProvider;
  if (p === 'openai') return { provider: p, configured: !!env.openaiKey, synthetic: false };
  if (p === 'azure') return { provider: p, configured: !!env.azureSpeechKey && !!env.azureSpeechRegion, synthetic: false };
  if (p === 'local') return { provider: p, configured: env.localEnginesAllowed, synthetic: false };
  if (p === 'mock') return { provider: p, configured: env.allowSyntheticProviders, synthetic: true };
  return { provider: 'none', configured: false, synthetic: false };
}

export function ttsStatus(): { provider: string; configured: boolean; synthetic: boolean; voices: string[] } {
  const p = env.ttsProvider;
  if (p === 'openai') return { provider: p, configured: !!env.openaiKey, synthetic: false, voices: env.openaiTtsVoices };
  if (p === 'azure') return { provider: p, configured: !!env.azureSpeechKey && !!env.azureSpeechRegion, synthetic: false, voices: env.azureTtsVoices };
  if (p === 'google') return { provider: p, configured: !!env.googleTtsKey, synthetic: false, voices: env.googleTtsVoices };
  // local = macOS `say` on a Mac, otherwise the GreekOS local speech service (open models).
  if (p === 'local') return { provider: p, configured: env.localEnginesAllowed, synthetic: false, voices: localTtsSupported() ? [] : ['coqui-el-css10'] };
  if (p === 'mock') return { provider: p, configured: env.allowSyntheticProviders, synthetic: true, voices: ['mock-a', 'mock-b'] };
  return { provider: 'none', configured: false, synthetic: false, voices: [] };
}

async function timed<T>(fn: () => Promise<T>, ms: number): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fn();
  } finally {
    clearTimeout(t);
  }
}

/** Transcribe a 16 kHz mono WAV utterance as el-GR. */
export async function transcribe(wav: Uint8Array, userId: string | null): Promise<AsrResult> {
  const st = asrStatus();
  if (!st.configured) throw new ProviderUnavailableError('Распознавание речи не подключено.');
  await assertBudget(userId);
  const info = parseWav(wav);
  const seconds = info ? info.durationMs / 1000 : 0;
  const started = Date.now();
  let ok = false;
  try {
    let result: AsrResult;
    if (st.provider === 'openai') {
      const form = new FormData();
      form.append('file', new Blob([wav as BlobPart], { type: 'audio/wav' }), 'utterance.wav');
      form.append('model', env.openaiAsrModel);
      form.append('language', 'el');
      form.append('response_format', 'json');
      form.append('include[]', 'logprobs');
      const res = await timed(() => fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${env.openaiKey}` }, body: form }), 30_000);
      if (!res.ok) throw new Error(`openai asr ${res.status}`);
      const json = (await res.json()) as { text?: string; logprobs?: Array<{ logprob: number }> };
      const lp = json.logprobs ?? [];
      const confidence = lp.length ? Math.exp(lp.reduce((a, l) => a + l.logprob, 0) / lp.length) : null;
      result = { text: (json.text ?? '').trim(), confidence, provider: 'openai', model: env.openaiAsrModel, durationMs: info?.durationMs ?? null, synthetic: false };
    } else if (st.provider === 'azure') {
      const url = `https://${env.azureSpeechRegion}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=el-GR&format=detailed`;
      const res = await timed(() => fetch(url, { method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': env.azureSpeechKey!, 'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000', Accept: 'application/json' }, body: wav as BodyInit }), 30_000);
      if (!res.ok) throw new Error(`azure asr ${res.status}`);
      const json = (await res.json()) as { RecognitionStatus?: string; NBest?: Array<{ Display?: string; Confidence?: number }> };
      const best = json.NBest?.[0];
      result = { text: json.RecognitionStatus === 'Success' ? (best?.Display ?? '').trim() : '', confidence: best?.Confidence ?? null, provider: 'azure', model: 'speech-to-text-rest-short', durationMs: info?.durationMs ?? null, synthetic: false };
    } else if (st.provider === 'local') {
      // Real recognition by the local Whisper service (development engine, Modern Greek).
      const r = await localTranscribe(wav, 'small', 30_000);
      result = { text: r.text, confidence: r.confidence, provider: 'local', model: `${r.engine}:${r.model}`, durationMs: info?.durationMs ?? null, synthetic: false };
    } else {
      // Synthetic transport for automated tests only: returns a fixed marker, never real recognition.
      result = { text: '[synthetic-asr]', confidence: null, provider: 'mock', model: 'mock-synthetic', durationMs: info?.durationMs ?? null, synthetic: true };
    }
    ok = true;
    return result;
  } finally {
    await recordUsage({ userId, provider: st.provider, operation: 'asr', units: seconds, unitKind: 'seconds', costUsd: seconds * COST.asrPerSecond, ok, latencyMs: Date.now() - started }).catch(() => undefined);
  }
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);
}

/** Synthesize el-GR speech as WAV. `rate` is a provider-supported speed control only. */
export async function synthesize(text: string, opts: { voice?: string; rate?: 'slow' | 'normal'; userId: string | null; operation?: string }): Promise<TtsResult> {
  const st = ttsStatus();
  if (!st.configured) throw new ProviderUnavailableError('Синтез речи не подключён.');
  if (!text.trim()) throw new Error('empty TTS text');
  await assertBudget(opts.userId);
  const voice = opts.voice ?? st.voices[0];
  const slow = opts.rate === 'slow';
  const started = Date.now();
  let ok = false;
  try {
    let bytes: Uint8Array;
    let model = '';
    if (st.provider === 'openai') {
      model = env.openaiTtsModel;
      const res = await timed(() => fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.openaiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, voice, input: text, response_format: 'wav', speed: slow ? 0.8 : 1.0, instructions: 'Speak standard Modern Greek (el-GR) with natural Greek stress and intonation. Read exactly the given text.' }),
      }), 45_000);
      if (!res.ok) throw new Error(`openai tts ${res.status}`);
      bytes = new Uint8Array(await res.arrayBuffer());
    } else if (st.provider === 'azure') {
      model = 'azure-neural-tts';
      const ssml = `<speak version="1.0" xml:lang="el-GR"><voice name="${escapeXml(voice)}"><prosody rate="${slow ? '-20%' : '0%'}">${escapeXml(text)}</prosody></voice></speak>`;
      const res = await timed(() => fetch(`https://${env.azureSpeechRegion}.tts.speech.microsoft.com/cognitiveservices/v1`, {
        method: 'POST',
        headers: { 'Ocp-Apim-Subscription-Key': env.azureSpeechKey!, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'riff-24khz-16bit-mono-pcm', 'User-Agent': 'greekos' },
        body: ssml,
      }), 45_000);
      if (!res.ok) throw new Error(`azure tts ${res.status}`);
      bytes = new Uint8Array(await res.arrayBuffer());
    } else if (st.provider === 'google') {
      model = 'google-cloud-tts';
      const res = await timed(() => fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(env.googleTtsKey!)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: { text }, voice: { languageCode: 'el-GR', name: voice }, audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: 24000, speakingRate: slow ? 0.8 : 1.0 } }),
      }), 45_000);
      if (!res.ok) throw new Error(`google tts ${res.status}`);
      const json = (await res.json()) as { audioContent?: string };
      bytes = Uint8Array.from(Buffer.from(json.audioContent ?? '', 'base64'));
    } else if (st.provider === 'local') {
      if (localTtsSupported() && voice && !voice.includes('coqui') && !voice.includes('mbrola')) {
        model = 'macos-say';
        bytes = await sayToWav(text, voice, slow ? 0.88 : 1);
      } else {
        const id = voice ?? 'coqui-el-css10';
        model = id.startsWith('mbrola') ? 'espeak-ng+mbrola' : 'coqui-vits-el-css10';
        bytes = (await serviceTts(id, text, slow ? 'slow' : 'normal')).wav;
      }
    } else {
      // Synthetic test tone (not speech) — labelled mock; never released to learners.
      model = 'mock-synthetic';
      const sr = 16000;
      const samples = new Int16Array(Math.max(sr / 2, Math.min(sr * 8, text.length * 900)));
      for (let i = 0; i < samples.length; i++) samples[i] = Math.round(Math.sin((2 * Math.PI * 220 * i) / sr) * 6000 * (i % 4000 < 3000 ? 1 : 0));
      bytes = buildWav(samples, sr);
    }
    if (!parseWav(bytes)) throw new Error('provider returned non-WAV/undecodable audio');
    ok = true;
    return { bytes, mime: 'audio/wav', provider: st.provider, model, voice, synthetic: true };
  } finally {
    await recordUsage({ userId: opts.userId, provider: st.provider, operation: opts.operation ?? 'tts', units: text.length, unitKind: 'characters', costUsd: text.length * COST.ttsPerChar, ok, latencyMs: Date.now() - started }).catch(() => undefined);
  }
}


export type SpeedProfile = 'normal' | 'slow' | 'fast';

/**
 * Synthesize with an explicit catalog voice (casting-driven). The provider is the voice's own
 * provider; speed uses the voice's measured speed profile. No pitch tricks to change presentation.
 */
export async function synthesizeWithVoice(text: string, voice: CatalogVoice, opts: { speed?: SpeedProfile; userId: string | null; operation?: string }): Promise<TtsResult> {
  if (!text.trim()) throw new Error('empty TTS text');
  if (!voice.available) throw new ProviderUnavailableError(`Голос ${voice.display_name} сейчас недоступен.`);
  const mult = voice.speed_profile?.[opts.speed ?? 'normal'] ?? 1;
  const started = Date.now();
  let ok = false;
  try {
    let bytes: Uint8Array;
    if (voice.provider === 'local_macos') {
      if (!env.localEnginesAllowed || !localTtsSupported()) throw new ProviderUnavailableError('Локальный голос доступен только в локальной среде macOS.');
      bytes = await sayToWav(text, voice.provider_voice_name, mult);
    } else if (voice.provider === 'local_coqui' || voice.provider === 'local_mbrola') {
      if (!env.localEnginesAllowed) throw new ProviderUnavailableError('Локальный речевой сервис доступен только в локальной среде.');
      bytes = (await serviceTts(voice.provider_voice_name, text, opts.speed ?? 'normal')).wav;
    } else if (voice.provider === 'azure') {
      if (!env.azureSpeechKey || !env.azureSpeechRegion) throw new ProviderUnavailableError('Azure Speech не подключён.');
      await assertBudget(opts.userId);
      const pct = Math.round((mult - 1) * 100);
      const ssml = `<speak version="1.0" xml:lang="el-GR"><voice name="${escapeXml(voice.provider_voice_name)}"><prosody rate="${pct >= 0 ? '+' : ''}${pct}%">${escapeXml(text)}</prosody></voice></speak>`;
      const res = await fetch(`https://${env.azureSpeechRegion}.tts.speech.microsoft.com/cognitiveservices/v1`, { method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': env.azureSpeechKey, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'riff-24khz-16bit-mono-pcm', 'User-Agent': 'greekos' }, body: ssml, signal: AbortSignal.timeout(45_000) });
      if (!res.ok) throw new Error(`azure tts ${res.status}`);
      bytes = new Uint8Array(await res.arrayBuffer());
    } else if (voice.provider === 'google') {
      if (!env.googleTtsKey) throw new ProviderUnavailableError('Google TTS не подключён.');
      await assertBudget(opts.userId);
      const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(env.googleTtsKey)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: { text }, voice: { languageCode: 'el-GR', name: voice.provider_voice_name }, audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: 24000, speakingRate: mult } }), signal: AbortSignal.timeout(45_000) });
      if (!res.ok) throw new Error(`google tts ${res.status}`);
      bytes = Uint8Array.from(Buffer.from(((await res.json()) as { audioContent?: string }).audioContent ?? '', 'base64'));
    } else if (voice.provider === 'openai') {
      if (!env.openaiKey) throw new ProviderUnavailableError('OpenAI не подключён.');
      await assertBudget(opts.userId);
      const res = await fetch('https://api.openai.com/v1/audio/speech', { method: 'POST', headers: { Authorization: `Bearer ${env.openaiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: env.openaiTtsModel, voice: voice.provider_voice_name, input: text, response_format: 'wav', speed: mult, instructions: 'Speak standard Modern Greek (el-GR) at a natural, moderate conversational pace. Read exactly the given text.' }), signal: AbortSignal.timeout(45_000) });
      if (!res.ok) throw new Error(`openai tts ${res.status}`);
      bytes = new Uint8Array(await res.arrayBuffer());
    } else {
      throw new ProviderUnavailableError('Тестовый голос не используется для синтеза речи.');
    }
    if (!parseWav(bytes)) throw new Error('provider returned non-WAV/undecodable audio');
    ok = true;
    const model = voice.provider === 'local_macos' ? 'macos-say' : voice.provider === 'local_coqui' ? 'coqui-vits-el-css10' : voice.provider === 'local_mbrola' ? `espeak-ng+mbrola:${voice.provider_voice_name}` : voice.provider;
    return { bytes, mime: 'audio/wav', provider: voice.provider, model, voice: voice.voice_id, synthetic: true };
  } finally {
    if (voice.engine_kind === 'cloud') {
      await recordUsage({ userId: opts.userId, provider: voice.provider, operation: opts.operation ?? 'tts_voice', units: text.length, unitKind: 'characters', costUsd: text.length * COST.ttsPerChar, ok, latencyMs: Date.now() - started }).catch(() => undefined);
    }
  }
}
