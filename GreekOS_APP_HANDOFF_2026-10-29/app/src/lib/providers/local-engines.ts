/**
 * Local development speech engines (no network, no paid services):
 *  - TTS: macOS System Voices via `say` (only voices the OS reports as installed for el_GR).
 *  - ASR: GreekOS local Whisper service (local-services/asr_server.py) on 127.0.0.1.
 * These produce REAL audio / REAL recognition, but they are development engines: macOS voices
 * are licensed for personal non-commercial use, so their output is marked DEV_LOCAL_ONLY.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface LocalVoice {
  id: string; // NSSpeechSynthesizer identifier
  name: string;
  locale: string;
  presentation: 'female' | 'male' | 'other' | 'unspecified';
  quality: string | null;
}

const JXA = `ObjC.import("AppKit");
var vs = $.NSSpeechSynthesizer.availableVoices; var out = [];
for (var i = 0; i < vs.count; i++) {
  var id = ObjC.unwrap(vs.objectAtIndex(i)); var a = $.NSSpeechSynthesizer.attributesForVoice(id);
  out.push({ id: id, name: ObjC.unwrap(a.objectForKey("VoiceName")), locale: ObjC.unwrap(a.objectForKey("VoiceLocaleIdentifier")), gender: ObjC.unwrap(a.objectForKey("VoiceGender")) });
}
JSON.stringify(out);`;

export function localTtsSupported(): boolean {
  return process.platform === 'darwin';
}

/** Lists installed el_GR voices with the gender the OS itself declares (never guessed). */
export async function listLocalGreekVoices(): Promise<LocalVoice[]> {
  if (!localTtsSupported()) return [];
  const { stdout } = await run('osascript', ['-l', 'JavaScript', '-e', JXA], { timeout: 15_000 });
  const all = JSON.parse(stdout.trim()) as Array<{ id: string; name: string; locale: string; gender: string | null }>;
  return all
    .filter((v) => /^el[_-]/i.test(v.locale ?? ''))
    .map((v) => ({
      id: v.id,
      name: v.name,
      locale: 'el-GR',
      presentation: v.gender === 'VoiceGenderFemale' ? 'female' : v.gender === 'VoiceGenderMale' ? 'male' : v.gender ? 'other' : 'unspecified',
      quality: /\.compact\./.test(v.id) ? 'compact' : /\.premium\./.test(v.id) ? 'premium' : /\.enhanced\./.test(v.id) ? 'enhanced' : null,
    }));
}

/** macOS `say` default rate is 175 wpm; speed profile multiplies it (normal 1.0, slow ~0.88, fast ~1.1). */
export const SAY_BASE_WPM = 175;

export async function sayToWav(text: string, voiceIdentifier: string, rateMultiplier = 1, sampleRate = 24000): Promise<Uint8Array> {
  if (!localTtsSupported()) throw new Error('macOS say is not available on this platform');
  const dir = await mkdtemp(join(tmpdir(), 'greekos-say-'));
  try {
    const input = join(dir, 'in.txt');
    const out = join(dir, 'out.wav');
    await writeFile(input, text, 'utf8');
    const args = ['-v', voiceNameFromIdentifier(voiceIdentifier), '-f', input, '-o', out, '--file-format=WAVE', `--data-format=LEI16@${sampleRate}`];
    if (Math.abs(rateMultiplier - 1) > 0.001) args.splice(2, 0, '-r', String(Math.round(SAY_BASE_WPM * rateMultiplier)));
    await run('say', args, { timeout: 120_000 });
    return new Uint8Array(await readFile(out));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function voiceNameFromIdentifier(id: string): string {
  // `say -v` accepts the voice name; identifiers look like com.apple.voice.compact.el-GR.Melina
  return id.split('.').pop() ?? id;
}

export interface LocalAsrResult {
  text: string;
  confidence: number | null;
  no_speech_prob: number;
  duration_s: number;
  elapsed_ms: number;
  model: string;
  engine: string;
  segments: Array<{ start: number; end: number; text: string; avg_logprob: number; no_speech_prob: number }>;
}

export function localAsrUrl(): string {
  return process.env.LOCAL_ASR_URL?.trim() || 'http://127.0.0.1:3312';
}

export async function localAsrHealth(): Promise<{ ok: boolean; available: string[]; loaded: string[] } | null> {
  try {
    const r = await fetch(`${localAsrUrl()}/health`, { signal: AbortSignal.timeout(1500) });
    return r.ok ? ((await r.json()) as { ok: boolean; available: string[]; loaded: string[] }) : null;
  } catch {
    return null;
  }
}

export async function localTranscribe(wav: Uint8Array, model: 'small' | 'medium' = 'small', timeoutMs = 60_000, maxTokens?: number): Promise<LocalAsrResult> {
  const headers: Record<string, string> = { 'content-type': 'audio/wav' };
  if (process.env.LOCAL_ASR_TOKEN) headers['x-local-asr-token'] = process.env.LOCAL_ASR_TOKEN;
  const r = await fetch(`${localAsrUrl()}/transcribe?model=${model}&lang=el${maxTokens ? `&max_tokens=${Math.round(maxTokens)}` : ''}`, { method: 'POST', headers, body: wav as BodyInit, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`local asr ${r.status}`);
  return (await r.json()) as LocalAsrResult;
}
