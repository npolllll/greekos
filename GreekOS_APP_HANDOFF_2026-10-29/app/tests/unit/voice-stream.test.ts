import { describe, expect, it } from 'vitest';
import { Vad, vadConfigForLevel, frameDbfs } from '@/lib/speaking/vad';
import { mintStreamToken, verifyStreamToken, splitSentences } from '@/lib/speaking/stream-token';
import { encodeAudioChunk, decodeAudioChunk, heardTextAt } from '@/lib/speaking/stream-protocol';
import { confirmationReason, type UtteranceTranscript } from '@/lib/providers/streaming-asr';

const FRAME = 320;
const noise = (amp: number) => new Int16Array(FRAME).map(() => Math.round((Math.random() - 0.5) * 2 * amp));
const voice = (amp: number) => new Int16Array(FRAME).map((_, i) => Math.round(amp * Math.sin(i / 2.3)));
function feed(v: Vad, frames: Int16Array[]) {
  const out = [];
  for (const f of frames) { const e = v.push(f); if (e) out.push(e); }
  return out;
}
const many = (n: number, f: () => Int16Array) => Array.from({ length: n }, f);

describe('adaptive VAD (learner-friendly end of turn)', () => {
  it('beginners get a longer hangover; short hesitant utterances get extra time', () => {
    expect(vadConfigForLevel('A1').baseHangoverMs).toBeGreaterThan(vadConfigForLevel('B2').baseHangoverMs);
    const v = new Vad(vadConfigForLevel('B1'));
    feed(v, many(50, () => noise(30)));
    feed(v, many(10, () => voice(6000))); // 200 ms of speech: short utterance
    expect(v.currentHangover()).toBe(vadConfigForLevel('B1').baseHangoverMs + vadConfigForLevel('B1').hesitationExtraMs);
  });

  it('a mid-sentence pause shorter than the hangover does not end the turn', () => {
    const v = new Vad(vadConfigForLevel('A1'));
    const ev = feed(v, [...many(50, () => noise(30)), ...many(60, () => voice(5000)), ...many(45, () => noise(30)), ...many(60, () => voice(5000)), ...many(120, () => noise(30))]);
    expect(ev.map((e) => e.type)).toEqual(['speech_start', 'end_of_turn']);
    const end = ev[1] as Extract<typeof ev[number], { type: 'end_of_turn' }>;
    expect(end.speechMs).toBeGreaterThanOrEqual(2400);
    expect(end.hangoverMs).toBe(1300);
  });

  it('quiet speech above an adapted noise floor is detected; steady noise is not speech', () => {
    const v = new Vad(vadConfigForLevel('A2'));
    expect(feed(v, many(200, () => noise(200)))).toEqual([]);
    expect(frameDbfs(voice(1200))).toBeLessThan(-25);
    expect(feed(v, many(20, () => voice(1200)))[0]?.type).toBe('speech_start');
  });

  it('«Готово» ends the turn immediately; max length is enforced', () => {
    const v = new Vad({ ...vadConfigForLevel('B2'), maxUtteranceMs: 1000 });
    feed(v, many(10, () => noise(20)));
    const ev = feed(v, many(60, () => voice(5000)));
    expect(ev.find((e) => e.type === 'end_of_turn')).toMatchObject({ type: 'end_of_turn', reason: 'max_length' });
    const w = new Vad(vadConfigForLevel('B2'));
    feed(w, [...many(10, () => noise(20)), ...many(10, () => voice(5000))]);
    expect(w.forceEnd()).toMatchObject({ type: 'end_of_turn', hangoverMs: 0 });
  });
});

describe('gateway credentials and protocol', () => {
  const secret = 'a'.repeat(48);
  it('tokens are bound to user+session, signed and short-lived', () => {
    const t = mintStreamToken(secret, 'u1', 's1', 60);
    expect(verifyStreamToken(secret, t)).toMatchObject({ sub: 'u1', sid: 's1' });
    expect(verifyStreamToken('b'.repeat(48), t)).toBeNull();
    const [body, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), sub: 'u2' })).toString('base64url');
    expect(verifyStreamToken(secret, `${forged}.${sig}`)).toBeNull();
    expect(verifyStreamToken(secret, mintStreamToken(secret, 'u1', 's1', -5))).toBeNull();
  });

  it('replies are split into sentences for incremental speech', () => {
    expect(splitSentences('Τα μήλα τελείωσαν. Έχουμε αχλάδια με δύο ευρώ το κιλό. Μπορείτε να διαλέξετε;')).toEqual(['Τα μήλα τελείωσαν.', 'Έχουμε αχλάδια με δύο ευρώ το κιλό.', 'Μπορείτε να διαλέξετε;']);
    // Very short fragments ride with the previous sentence (no tiny synthesis calls).
    expect(splitSentences('Έχουμε αχλάδια με δύο ευρώ το κιλό. Θέλετε;')).toEqual(['Έχουμε αχλάδια με δύο ευρώ το κιλό. Θέλετε;']);
    expect(splitSentences('Ναι. Ωραία!')).toHaveLength(1);
  });

  it('audio chunks round-trip with their header', () => {
    const pcm = new Int16Array([1, -2, 300, -32768, 32767]);
    const { header, pcm: back } = decodeAudioChunk(encodeAudioChunk({ turn_id: 't', seq: 3, sentence: 1, sample_rate: 24000, start_ms: 1200, last: true }, pcm));
    expect(header).toMatchObject({ turn_id: 't', seq: 3, sample_rate: 24000, last: true });
    expect([...back]).toEqual([...pcm]);
  });

  it('heard text after barge-in = finished sentences + leading words of the current one', () => {
    const tl = [{ text: 'Τα μήλα τελείωσαν.', start_ms: 0, end_ms: 1000 }, { text: 'Έχουμε αχλάδια με δύο ευρώ το κιλό.', start_ms: 1000, end_ms: 3000 }];
    expect(heardTextAt(tl, 400)).toBe('Τα…');
    expect(heardTextAt(tl, 1000)).toBe('Τα μήλα τελείωσαν.');
    expect(heardTextAt(tl, 2000)).toBe('Τα μήλα τελείωσαν. Έχουμε αχλάδια με…');
    expect(heardTextAt(tl, 0)).toBe('');
  });
});

describe('uncertain recognition is confirmed, never penalised', () => {
  const t = (o: Partial<UtteranceTranscript>): UtteranceTranscript => ({ text: 'Θέλω ένα καφέ', confidence: 0.8, noSpeechProb: 0.01, provider: 'local', model: 'x', elapsedMs: 1, synthetic: false, ...o });
  it('asks «Это вы сказали?» for low confidence, missing confidence, probable silence, non-Greek, synthetic', () => {
    expect(confirmationReason(t({}))).toBeNull();
    expect(confirmationReason(t({ confidence: 0.3 }))).toBe('low_confidence');
    expect(confirmationReason(t({ confidence: null }))).toBe('no_confidence');
    expect(confirmationReason(t({ noSpeechProb: 0.9 }))).toBe('possible_silence');
    expect(confirmationReason(t({ text: 'I want a coffee' }))).toBe('not_greek');
    expect(confirmationReason(t({ synthetic: true }))).toBe('synthetic');
    expect(confirmationReason(t({}), { snrDb: 12 })).toBe('noisy_audio');
    expect(confirmationReason(t({}), { snrDb: 35 })).toBeNull();
  });
});
