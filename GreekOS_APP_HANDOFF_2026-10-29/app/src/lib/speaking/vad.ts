/**
 * Adaptive energy VAD with learner-friendly end-of-turn (v5.4 §5). Pure and deterministic:
 * fed 20 ms PCM16 frames, it tracks the noise floor, detects speech start, and only ends a turn
 * after an adaptive silence hangover — longer for beginners and for short, hesitant utterances.
 * A pause is never treated as an error or a cue to interrupt the learner.
 */
export interface VadConfig {
  frameMs: number;
  minSpeechFrames: number;       // consecutive voiced frames to start speech
  baseHangoverMs: number;        // silence before end-of-turn
  hesitationExtraMs: number;     // added when the utterance so far is short
  shortUtteranceMs: number;
  maxHangoverMs: number;
  marginDb: number;              // threshold above the noise floor
  absoluteMinDbfs: number;       // never trigger below this level
  maxUtteranceMs: number;
}

export function vadConfigForLevel(level: string | null | undefined): VadConfig {
  const base = level === 'A0' || level === 'A1' ? 1300 : level === 'A2' ? 1100 : 900;
  return { frameMs: 20, minSpeechFrames: 3, baseHangoverMs: base, hesitationExtraMs: 500, shortUtteranceMs: 800, maxHangoverMs: 2500, marginDb: 12, absoluteMinDbfs: -50, maxUtteranceMs: 60_000 };
}

export type VadEvent =
  | { type: 'speech_start'; atMs: number; preRollFrames: number }
  | { type: 'end_of_turn'; atMs: number; lastVoicedMs: number; speechMs: number; hangoverMs: number; reason: 'silence' | 'max_length' };

export function frameDbfs(frame: Int16Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  const rms = Math.sqrt(sum / Math.max(1, frame.length));
  return rms <= 0 ? -120 : 20 * Math.log10(rms / 32768);
}

/** Typical speech level of an utterance: median dBFS of its louder half of 20 ms frames. */
export function speechLevelDbfs(pcm: Int16Array, frame = 320): number {
  const levels: number[] = [];
  for (let o = 0; o + frame <= pcm.length; o += frame) levels.push(frameDbfs(pcm.subarray(o, o + frame)));
  if (!levels.length) return -120;
  levels.sort((a, b) => b - a);
  const top = levels.slice(0, Math.max(1, Math.ceil(levels.length / 2)));
  return top[Math.floor(top.length / 2)];
}

export class Vad {
  private floor = -55;
  private voicedRun = 0;
  private inSpeech = false;
  private speechStartMs = 0;
  private lastVoicedMs = 0;
  private voicedMs = 0;
  private t = 0;
  constructor(public cfg: VadConfig) {}

  get speaking() { return this.inSpeech; }
  get noiseFloorDbfs() { return this.floor; }
  /** Silence so far inside the current utterance (0 while voiced or outside speech). */
  get trailingSilenceMs() { return this.inSpeech ? this.t - this.lastVoicedMs : 0; }

  threshold() {
    return Math.max(this.floor + this.cfg.marginDb, this.cfg.absoluteMinDbfs);
  }

  currentHangover(): number {
    const extra = this.voicedMs < this.cfg.shortUtteranceMs ? this.cfg.hesitationExtraMs : 0;
    return Math.min(this.cfg.maxHangoverMs, this.cfg.baseHangoverMs + extra);
  }

  /** Feed one frame; returns an event when the speech state changes. */
  push(frame: Int16Array): VadEvent | null {
    this.t += this.cfg.frameMs;
    const db = frameDbfs(frame);
    const voiced = db > this.threshold();
    if (!this.inSpeech) {
      if (!voiced) {
        // Track the noise floor only on non-speech frames (slow EMA).
        this.floor = this.floor * 0.95 + Math.max(-90, Math.min(-25, db)) * 0.05;
        this.voicedRun = 0;
        return null;
      }
      this.voicedRun += 1;
      if (this.voicedRun >= this.cfg.minSpeechFrames) {
        this.inSpeech = true;
        this.speechStartMs = this.t - this.cfg.minSpeechFrames * this.cfg.frameMs;
        this.lastVoicedMs = this.t;
        this.voicedMs = this.cfg.minSpeechFrames * this.cfg.frameMs;
        return { type: 'speech_start', atMs: this.speechStartMs, preRollFrames: this.cfg.minSpeechFrames + 15 };
      }
      return null;
    }
    if (voiced) {
      this.lastVoicedMs = this.t;
      this.voicedMs += this.cfg.frameMs;
    }
    const hang = this.currentHangover();
    if (this.t - this.lastVoicedMs >= hang) return this.end('silence', hang);
    if (this.t - this.speechStartMs >= this.cfg.maxUtteranceMs) return this.end('max_length', hang);
    return null;
  }

  /** Learner pressed "Готово": end immediately (explicit control alongside automatic detection). */
  forceEnd(): VadEvent | null {
    if (!this.inSpeech) return null;
    return this.end('silence', 0);
  }

  private end(reason: 'silence' | 'max_length', hang: number): VadEvent {
    const ev: VadEvent = { type: 'end_of_turn', atMs: this.t, lastVoicedMs: this.lastVoicedMs, speechMs: this.voicedMs, hangoverMs: hang, reason };
    this.inSpeech = false;
    this.voicedRun = 0;
    this.voicedMs = 0;
    return ev;
  }
}
