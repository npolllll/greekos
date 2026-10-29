/**
 * Wire protocol of the streaming voice gateway (shared by the gateway, the browser hook and tests).
 * Control messages are JSON text frames. Microphone audio goes up as raw PCM16 LE mono 16 kHz
 * binary frames; synthesized speech comes down as binary frames: [u32 LE header length][JSON
 * header][PCM16 LE mono samples].
 */
export const STREAM_PROTOCOL = 'greekos-voice.v1';
export const INPUT_SAMPLE_RATE = 16_000;
export const FRAME_SAMPLES = 320; // 20 ms at 16 kHz
export const GATEWAY_PATH = '/v1/stream';

export type Speed = 'normal' | 'slow' | 'fast';
export type InputSource = 'microphone' | 'synthetic_test_clip';
export type GatewayState = 'listening' | 'speech' | 'transcribing' | 'confirming' | 'thinking' | 'speaking' | 'paused';
export type ConfirmReasonWire = 'low_confidence' | 'no_confidence' | 'possible_silence' | 'not_greek' | 'noisy_audio' | 'synthetic';

export type ClientMessage =
  | { type: 'auth'; token: string; input_source?: InputSource; speed?: Speed }
  | { type: 'listen'; mic_ready_ms?: number }
  | { type: 'done' }
  | { type: 'interrupt'; turn_id: string; heard_ms: number }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'replay'; turn_id: string; speed: Speed }
  | { type: 'speed'; speed: Speed }
  | { type: 'confirm'; utterance_id: string; text: string; edited: boolean }
  | { type: 'discard'; utterance_id: string }
  | { type: 'repair' }
  | { type: 'help_used'; kind: string }
  | { type: 'playback'; turn_id: string; event: 'started' | 'ended' };

export interface PersonaWire { cast_role_id: string | null; voice_name: string | null; presentation: string | null; provider: string | null; dev_only: boolean }

export type ServerMessage =
  | { type: 'ready'; protocol: string; session_id: string; persona: PersonaWire; asr: { provider: string; partials: boolean; native_streaming: boolean }; vad: { base_hangover_ms: number; max_hangover_ms: number }; speed: Speed; view: unknown }
  | { type: 'state'; state: GatewayState }
  | { type: 'vad'; event: 'speech_start' | 'end_of_turn' | 'ignored_during_playback'; hangover_ms?: number; speech_ms?: number }
  | { type: 'partial'; utterance_id: string; text: string }
  | { type: 'final'; utterance_id: string; text: string; confidence: number | null; needs_confirmation: boolean; reason: ConfirmReasonWire | null; empty: boolean }
  | { type: 'turn'; view: unknown; engine: string | null; hint_ru: string | null }
  | { type: 'assistant_start'; turn_id: string; text: string; sentences: string[]; speed: Speed; replay: boolean }
  | { type: 'assistant_end'; turn_id: string; total_ms: number }
  | { type: 'assistant_text_only'; turn_id: string; text: string; reason: string }
  | { type: 'interrupted'; turn_id: string; heard_ms: number; heard_text: string }
  | { type: 'metrics'; turn_seq: number; metrics: Record<string, number | boolean | string | null> }
  | { type: 'error'; code: string; message: string; fatal: boolean };

export interface AudioChunkHeader { turn_id: string; seq: number; sentence: number; sample_rate: number; start_ms: number; last: boolean }

export function encodeAudioChunk(header: AudioChunkHeader, pcm: Int16Array): Uint8Array {
  const h = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(4 + h.length + pcm.byteLength);
  new DataView(out.buffer).setUint32(0, h.length, true);
  out.set(h, 4);
  out.set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), 4 + h.length);
  return out;
}

export function decodeAudioChunk(data: ArrayBuffer | Uint8Array): { header: AudioChunkHeader; pcm: Int16Array } {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const len = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + len))) as AudioChunkHeader;
  const body = bytes.slice(4 + len); // copy: Int16Array needs 2-byte alignment
  return { header, pcm: new Int16Array(body.buffer, 0, Math.floor(body.byteLength / 2)) };
}

/**
 * What the learner actually heard of an interrupted reply: whole sentences that finished playing
 * plus the leading words of the sentence in progress (estimated from its playback time).
 */
export function heardTextAt(timeline: Array<{ text: string; start_ms: number; end_ms: number }>, heardMs: number): string {
  const parts: string[] = [];
  for (const s of timeline) {
    if (s.end_ms <= heardMs) { parts.push(s.text); continue; }
    if (s.start_ms < heardMs) {
      const words = s.text.split(/\s+/).filter(Boolean);
      const n = Math.floor((words.length * (heardMs - s.start_ms)) / Math.max(1, s.end_ms - s.start_ms));
      if (n > 0) parts.push(`${words.slice(0, n).join(' ')}…`);
    }
    break;
  }
  return parts.join(' ');
}
