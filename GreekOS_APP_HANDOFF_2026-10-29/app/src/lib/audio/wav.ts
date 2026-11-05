/** Minimal RIFF/WAVE PCM16 parsing, synthesis and technical measurements (no external decoder). */

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataOffset: number;
  dataLength: number;
  durationMs: number;
}

export function parseWav(bytes: Uint8Array): WavInfo | null {
  if (bytes.length < 44) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let off = 12;
  let fmt: { channels: number; sampleRate: number; bits: number; format: number } | null = null;
  while (off + 8 <= bytes.length) {
    const id = tag(off);
    let size = dv.getUint32(off + 4, true);
    const body = off + 8;
    if (id === 'fmt ') {
      fmt = { format: dv.getUint16(body, true), channels: dv.getUint16(body + 2, true), sampleRate: dv.getUint32(body + 4, true), bits: dv.getUint16(body + 14, true) };
    } else if (id === 'data') {
      if (!fmt || (fmt.format !== 1 && fmt.format !== 0xfffe) || fmt.bits !== 16 || !fmt.channels || !fmt.sampleRate) return null;
      // Streaming providers may write 0xFFFFFFFF/0 as placeholder size: use the remaining bytes.
      if (size === 0 || size === 0xffffffff || body + size > bytes.length) size = bytes.length - body;
      size -= size % (2 * fmt.channels);
      const frames = size / (2 * fmt.channels);
      return { sampleRate: fmt.sampleRate, channels: fmt.channels, bitsPerSample: 16, dataOffset: body, dataLength: size, durationMs: Math.round((frames / fmt.sampleRate) * 1000) };
    }
    off = body + size + (size % 2);
  }
  return null;
}

/** Mono PCM16 samples (channels averaged). */
export function pcmSamples(bytes: Uint8Array, info: WavInfo): Int16Array {
  const dv = new DataView(bytes.buffer, bytes.byteOffset + info.dataOffset, info.dataLength);
  const frames = info.dataLength / (2 * info.channels);
  const out = new Int16Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let c = 0; c < info.channels; c++) s += dv.getInt16((i * info.channels + c) * 2, true);
    out[i] = Math.round(s / info.channels);
  }
  return out;
}

export function buildWav(samples: Int16Array, sampleRate: number): Uint8Array {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const dv = new DataView(buf);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); dv.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVE');
  w(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sampleRate, true); dv.setUint32(28, sampleRate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  w(36, 'data'); dv.setUint32(40, samples.length * 2, true);
  new Int16Array(buf, 44).set(samples);
  return new Uint8Array(buf);
}

const dbfs = (amp: number) => (amp <= 0 ? -Infinity : 20 * Math.log10(amp / 32768));

export interface TechnicalReport {
  duration_ms: number;
  sample_rate: number;
  channels: number;
  peak_dbfs: number;
  rms_dbfs: number;
  clipping_ratio: number;
  leading_silence_ms: number;
  trailing_silence_ms: number;
  longest_pause_ms: number;
  speech_ratio: number;
  checks: Record<string, boolean>;
  pass: boolean;
  profile: string;
}

/**
 * Technical-only measurements from actual bytes. Thresholds are the explicit project production
 * profile below; a pass says nothing about linguistic or pronunciation quality.
 */
export const PROFILE = {
  id: 'greekos-tts-technical/1',
  minDurationMs: 300,
  maxClippingRatio: 0.001,
  minPeakDbfs: -30,
  minRmsDbfs: -42,
  maxEdgeSilenceMs: 2500,
  maxPauseMs: 3500,
  silenceDbfs: -45,
  windowMs: 20,
};

export function analyzeWav(bytes: Uint8Array, opts: { allowedPauseMs?: number } = {}): TechnicalReport | null {
  const info = parseWav(bytes);
  if (!info) return null;
  const s = pcmSamples(bytes, info);
  let peak = 0;
  let sumSq = 0;
  let clipped = 0;
  for (let i = 0; i < s.length; i++) {
    const a = Math.abs(s[i]);
    if (a > peak) peak = a;
    sumSq += s[i] * s[i];
    if (a >= 32760) clipped++;
  }
  const win = Math.max(1, Math.round((info.sampleRate * PROFILE.windowMs) / 1000));
  const voiced: boolean[] = [];
  for (let i = 0; i < s.length; i += win) {
    let e = 0;
    const end = Math.min(s.length, i + win);
    for (let j = i; j < end; j++) e += s[j] * s[j];
    voiced.push(dbfs(Math.sqrt(e / (end - i))) > PROFILE.silenceDbfs);
  }
  const first = voiced.indexOf(true);
  const last = voiced.lastIndexOf(true);
  let longest = 0;
  let run = 0;
  for (let i = Math.max(0, first); i <= last; i++) {
    run = voiced[i] ? 0 : run + 1;
    if (run > longest) longest = run;
  }
  const voicedCount = voiced.filter(Boolean).length;
  const rep = {
    duration_ms: info.durationMs,
    sample_rate: info.sampleRate,
    channels: info.channels,
    peak_dbfs: Number(dbfs(peak).toFixed(2)),
    rms_dbfs: Number(dbfs(Math.sqrt(sumSq / Math.max(1, s.length))).toFixed(2)),
    clipping_ratio: s.length ? clipped / s.length : 0,
    leading_silence_ms: first < 0 ? info.durationMs : first * PROFILE.windowMs,
    trailing_silence_ms: last < 0 ? info.durationMs : (voiced.length - 1 - last) * PROFILE.windowMs,
    longest_pause_ms: longest * PROFILE.windowMs,
    speech_ratio: voiced.length ? voicedCount / voiced.length : 0,
  };
  const checks = {
    decodable: true,
    duration: rep.duration_ms >= PROFILE.minDurationMs,
    has_speech_energy: first >= 0 && rep.peak_dbfs >= PROFILE.minPeakDbfs && rep.rms_dbfs >= PROFILE.minRmsDbfs,
    no_clipping: rep.clipping_ratio <= PROFILE.maxClippingRatio,
    edge_silence: rep.leading_silence_ms <= PROFILE.maxEdgeSilenceMs && rep.trailing_silence_ms <= PROFILE.maxEdgeSilenceMs,
    pauses: rep.longest_pause_ms <= (opts.allowedPauseMs ?? PROFILE.maxPauseMs),
  };
  return { ...rep, checks, pass: Object.values(checks).every(Boolean), profile: PROFILE.id };
}

/** Concatenate mono PCM16 WAV segments with fixed gaps; returns measured cue intervals. */
export function concatWav(segments: Uint8Array[], gapMs: number | number[]): { wav: Uint8Array; cues: Array<{ start_ms: number; end_ms: number }> } {
  const infos = segments.map((b) => parseWav(b));
  if (infos.some((i) => !i)) throw new Error('segment is not decodable PCM16 WAV');
  const rate = infos[0]!.sampleRate;
  if (infos.some((i) => i!.sampleRate !== rate)) throw new Error('segments have different sample rates');
  const parts = segments.map((b, k) => pcmSamples(b, infos[k]!));
  // gapMs[k] is the silence inserted BEFORE segment k (k >= 1).
  const gapAt = (k: number) => Math.round((rate * (Array.isArray(gapMs) ? gapMs[k] ?? 0 : gapMs)) / 1000);
  const total = parts.reduce((a, p, k) => a + p.length + (k > 0 ? gapAt(k) : 0), 0);
  const out = new Int16Array(total);
  const cues: Array<{ start_ms: number; end_ms: number }> = [];
  let pos = 0;
  parts.forEach((p, k) => {
    if (k > 0) pos += gapAt(k);
    out.set(p, pos);
    cues.push({ start_ms: Math.round((pos / rate) * 1000), end_ms: Math.round(((pos + p.length) / rate) * 1000) });
    pos += p.length;
  });
  return { wav: buildWav(out, rate), cues };
}

/**
 * Loudness normalisation for delivery copies: one linear gain towards -20 dBFS RMS, limited so the
 * peak stays ≤ -1 dBFS. No compression or EQ (phonetic contrasts are left untouched).
 */
export function normalizeLoudness(bytes: Uint8Array, targetRmsDbfs = -20, peakCeilingDbfs = -1): { wav: Uint8Array; report: { gain_db: number; before: { rms_dbfs: number; peak_dbfs: number }; after: { rms_dbfs: number; peak_dbfs: number }; target_rms_dbfs: number; peak_ceiling_dbfs: number } } {
  const info = parseWav(bytes);
  if (!info) throw new Error('normalizeLoudness: not a PCM16 WAV');
  const s = pcmSamples(bytes, info);
  let peak = 0;
  let sumSq = 0;
  for (const v of s) { const a = Math.abs(v); if (a > peak) peak = a; sumSq += v * v; }
  const rms = Math.sqrt(sumSq / Math.max(1, s.length));
  const db = (a: number) => (a <= 0 ? -Infinity : 20 * Math.log10(a / 32768));
  const toLin = (d: number) => 32768 * 10 ** (d / 20);
  const gain = rms > 0 && peak > 0 ? Math.min(toLin(targetRmsDbfs) / rms, toLin(peakCeilingDbfs) / peak) : 1;
  const out = new Int16Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(s[i] * gain)));
  const r2 = (x: number) => Number(x.toFixed(2));
  return {
    wav: buildWav(out, info.sampleRate),
    report: { gain_db: r2(20 * Math.log10(gain)), before: { rms_dbfs: r2(db(rms)), peak_dbfs: r2(db(peak)) }, after: { rms_dbfs: r2(db(rms * gain)), peak_dbfs: r2(db(peak * gain)) }, target_rms_dbfs: targetRmsDbfs, peak_ceiling_dbfs: peakCeilingDbfs },
  };
}
