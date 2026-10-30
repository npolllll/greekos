import { stripAccents } from '../scoring/normalize.ts';

/** Tokenise Greek text for round-trip comparison: NFC, lowercase, punctuation removed, accents KEPT. */
export function tokens(s: string): string[] {
  // ASR writes symbols/units where the script has words («3 €/kg» for «τρία ευρώ το κιλό»).
  const expanded = s.normalize('NFC').replace(/\/\s*kg\b/gi, ' το κιλό ').replace(/€/g, ' ευρώ ').replace(/%/g, ' τοις εκατό ').replace(/\bkg\b/gi, ' κιλό ').replace(/\bkm\b/gi, ' χιλιόμετρα ');
  return expanded.toLowerCase().replace(/ς/g, 'σ').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
}

// Greek number words (accent-stripped, all gender forms) → value; ASR often writes digits instead.
const UNITS: Record<string, number> = { μηδεν: 0, ενα: 1, εναν: 1, ενασ: 1, μια: 1, μια_: 1, μιασ: 1, δυο: 2, τρια: 3, τρεισ: 3, τεσσερα: 4, τεσσερισ: 4, πεντε: 5, εξι: 6, επτα: 7, εφτα: 7, οκτω: 8, οχτω: 8, εννεα: 9, εννια: 9, δεκα: 10, εντεκα: 11, ενδεκα: 11, δωδεκα: 12 };
const TENS: Record<string, number> = { εικοσι: 20, τριαντα: 30, σαραντα: 40, πενηντα: 50, εξηντα: 60, εβδομηντα: 70, ογδοντα: 80, ενενηντα: 90 };
const HUNDREDS: Record<string, number> = { εκατο: 100, εκατον: 100, διακοσια: 200, διακοσιεσ: 200, διακοσιοι: 200, τριακοσια: 300, τριακοσιεσ: 300, τετρακοσια: 400, πεντακοσια: 500, εξακοσια: 600, επτακοσια: 700, εφτακοσια: 700, οκτακοσια: 800, οχτακοσια: 800, εννιακοσια: 900, χιλια: 1000, χιλιεσ: 1000 };
const TEEN = /^δεκα(τρια|τρεισ|τεσσερα|τεσσερισ|πεντε|εξι|επτα|εφτα|οκτω|οχτω|εννεα|εννια)$/;

function numberValue(bare: string): number | null {
  if (bare in UNITS) return UNITS[bare];
  if (bare in TENS) return TENS[bare];
  if (bare in HUNDREDS) return HUNDREDS[bare];
  const t = TEEN.exec(bare);
  return t ? 10 + (UNITS[t[1]] ?? 0) : null;
}

/**
 * Collapses runs of Greek number words into one numeral token («είκοσι πέντε» → «25») so that a
 * hypothesis written with digits is compared fairly. Only used for round-trip screening.
 */
export function normalizeNumerals(tok: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tok.length; i++) {
    let v = numberValue(stripAccents(tok[i]));
    if (v === null || (v === 1 && !/^\d/.test(tok[i]) && !(numberValue(stripAccents(tok[i + 1] ?? '')) !== null))) {
      // «ένα/μια» alone is usually an article, not a number: keep it as a word.
      out.push(tok[i]);
      continue;
    }
    let total = v;
    while (i + 1 < tok.length && (v = numberValue(stripAccents(tok[i + 1]))) !== null) { total = v >= 1000 ? Math.max(1, total) * v : total + v; i++; }
    out.push(String(total));
  }
  // A lone «ένα/μία» stays a word above; a lone digit 1 from the ASR is mapped back to it.
  return out.map((t) => (t === '1' ? 'ένα' : t));
}

function editDistance<T>(a: T[], b: T[]): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

export interface RoundTripMetrics {
  wer: number;
  cer_accent_insensitive: number;
  /** CER over a coarse phonemic transcription: ASR homophone spellings (βήτα/βίτα, παιδί/πεδί) do not count. */
  cer_phonetic: number;
  accent_mismatches: string[];
  reference_words: number;
}

const DIGRAPHS: Array<[RegExp, string]> = [
  [/ου/g, 'u'], [/αι/g, 'e'], [/ει|οι|υι/g, 'i'], [/αυ(?=[θκξπστφχψ]|$)/g, 'af'], [/ευ(?=[θκξπστφχψ]|$)/g, 'ef'], [/αυ/g, 'av'], [/ευ/g, 'ev'], [/ηυ/g, 'iv'],
  [/μπ/g, 'b'], [/ντ/g, 'd'], [/γκ|γγ/g, 'g'], [/τσ|τς/g, 'c'], [/τζ/g, 'j'],
];
const LETTERS: Record<string, string> = { α: 'a', ε: 'e', η: 'i', ι: 'i', υ: 'i', ο: 'o', ω: 'o', β: 'v', γ: 'G', δ: 'D', ζ: 'z', θ: 'T', κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'ks', π: 'p', ρ: 'r', σ: 's', ς: 's', τ: 't', φ: 'f', χ: 'x', ψ: 'ps' };

/** Coarse Modern Greek grapheme→phoneme key (screening only): «βήτα» and «βίτα» both give "vita". */
export function phonemicKey(s: string): string {
  let t = s.normalize('NFD').toLowerCase();
  t = t.replace(/[\u0301\u0300]/g, ''); // tonos/oxia; keep diaeresis to block digraphs
  t = t.normalize('NFC');
  for (const [re, rep] of DIGRAPHS) t = t.replace(re, rep);
  t = t.replace(/[ϊΐ]/g, 'i').replace(/[ϋΰ]/g, 'i');
  let out = '';
  for (const ch of t) out += LETTERS[ch] ?? (/[a-zGDTx0-9 ]/.test(ch) ? ch : /\s/.test(ch) ? ' ' : '');
  return out.replace(/([bcdfgGjklmnprstvxzDT])\1+/g, '$1').replace(/\s+/g, ' ').trim();
}

function vowelNuclei(bare: string): number {
  return (bare.replace(/αι|ει|οι|υι|ου|αυ|ευ/g, 'V').match(/[αεηιουωV]/g) ?? []).length;
}

/**
 * ASR round-trip of synthesized audio. Greek ASR errs too, so this is a screening signal and
 * never proof of correct pronunciation.
 */
export function roundTrip(reference: string, hypothesis: string): RoundTripMetrics {
  const ref = normalizeNumerals(tokens(reference));
  const hyp = normalizeNumerals(tokens(hypothesis));
  const wer = ref.length ? editDistance(ref, hyp) / ref.length : hyp.length ? 1 : 0;
  const refChars = [...stripAccents(ref.join(' '))];
  const hypChars = [...stripAccents(hyp.join(' '))];
  const cer = refChars.length ? editDistance(refChars, hypChars) / refChars.length : 0;
  const hypSet = new Set(hyp);
  const hypBare = new Map(hyp.map((h) => [stripAccents(h), h]));
  // Monosyllables (πού/που, πώς/πως, ή/η) carry a distinguishing accent, not a stress position: the ASR's
  // spelling of them says nothing about the audio, so only polysyllables count as stress mismatches.
  const accent = ref.filter((w) => !hypSet.has(w) && hypBare.has(stripAccents(w)) && hypBare.get(stripAccents(w)) !== w && vowelNuclei(stripAccents(w)) > 1);
  const pRef = [...phonemicKey(ref.join(' '))];
  const pHyp = [...phonemicKey(hyp.join(' '))];
  const pcer = pRef.length ? editDistance(pRef, pHyp) / pRef.length : 0;
  return { wer: Number(wer.toFixed(4)), cer_accent_insensitive: Number(cer.toFixed(4)), cer_phonetic: Number(pcer.toFixed(4)), accent_mismatches: [...new Set(accent)], reference_words: ref.length };
}

export const ROUNDTRIP_THRESHOLDS = { maxWer: 0.25, maxCer: 0.12, maxPhoneticCer: 0.1, maxPhoneticWer: 0.35, maxAccentMismatchRatio: 0.05 };

/**
 * Orthographic pass (WER/CER) or, because ASR spells homophones freely, a phonemic pass: low
 * phonemic CER with bounded WER (any WER for ≤3-word scripts such as letter names and greetings).
 */
export function roundTripPass(m: RoundTripMetrics): boolean {
  const accentsOk = m.accent_mismatches.length <= Math.max(0, Math.floor(m.reference_words * ROUNDTRIP_THRESHOLDS.maxAccentMismatchRatio));
  const ortho = m.wer <= ROUNDTRIP_THRESHOLDS.maxWer && m.cer_accent_insensitive <= ROUNDTRIP_THRESHOLDS.maxCer;
  const phon = typeof m.cer_phonetic === 'number' && m.cer_phonetic <= ROUNDTRIP_THRESHOLDS.maxPhoneticCer && (m.reference_words <= 3 || m.wer <= ROUNDTRIP_THRESHOLDS.maxPhoneticWer);
  return accentsOk && (ortho || phon);
}

/** Split long monologues into provider-safe chunks on sentence boundaries. */
export function chunkText(text: string, maxChars = 1200): string[] {
  const paras = text.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of paras) {
    if (p.length <= maxChars) { out.push(p); continue; }
    const sentences = p.match(/[^.;!?·]+[.;!?·]*\s*/gu) ?? [p];
    let cur = '';
    for (const s of sentences) {
      if ((cur + s).length > maxChars && cur) { out.push(cur.trim()); cur = ''; }
      cur += s;
    }
    if (cur.trim()) out.push(cur.trim());
  }
  return out;
}

/**
 * Word-level differences between the script and the ASR hypothesis: missing words (possible
 * truncation/omission), inserted words and immediate repetitions (possible glitch/stutter).
 * Screening signals for a reviewer — not proof of an error in the audio.
 */
export function alignmentDiff(reference: string, hypothesis: string): { missing: string[]; inserted: string[]; repeated: string[] } {
  const ref = normalizeNumerals(tokens(reference)).map(stripAccents);
  const hyp = normalizeNumerals(tokens(hypothesis)).map(stripAccents);
  const dp: number[][] = Array.from({ length: ref.length + 1 }, (_, i) => Array.from({ length: hyp.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= ref.length; i++) for (let j = 1; j <= hyp.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
  const missing: string[] = [];
  const inserted: string[] = [];
  for (let i = ref.length, j = hyp.length; i > 0 || j > 0;) {
    if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1)) { if (ref[i - 1] !== hyp[j - 1]) { missing.push(ref[i - 1]); inserted.push(hyp[j - 1]); } i--; j--; }
    else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) { missing.push(ref[i - 1]); i--; }
    else { inserted.push(hyp[j - 1]); j--; }
  }
  const repeated = hyp.filter((w, k) => k > 0 && w === hyp[k - 1] && w.length > 2 && !ref.some((r, m) => m > 0 && r === w && ref[m - 1] === w));
  return { missing: missing.reverse(), inserted: inserted.reverse(), repeated: [...new Set(repeated)] };
}

/** Approximate Greek syllable count (vowel nuclei; common digraphs count once). */
export function syllableCount(text: string): number {
  const t = stripAccents(text.normalize('NFC').toLowerCase());
  return (t.match(/αι|ει|οι|ου|υι|αυ|ευ|ηυ|[αεηιουωϊϋ]/g) ?? []).length;
}

export interface SegmentSignals { segment: number; speech_rate_syll_per_s: number | null; rate_flag: 'too_slow' | 'too_fast' | null; truncated_end: boolean; tail_dbfs: number }

/**
 * Prosody/segmentation screening per rendered segment, from the actual samples: speaking rate
 * (syllables per second of non-silent audio) and energy right at the end (a cut-off word).
 */
export function segmentSignals(texts: string[], wavs: Uint8Array[], pcmOf: (b: Uint8Array) => { samples: Int16Array; rate: number } | null): SegmentSignals[] {
  return wavs.map((w, k) => {
    const p = pcmOf(w);
    if (!p) return { segment: k, speech_rate_syll_per_s: null, rate_flag: null, truncated_end: false, tail_dbfs: -120 };
    const win = Math.round(p.rate * 0.02);
    let voiced = 0;
    for (let o = 0; o + win <= p.samples.length; o += win) {
      let s = 0;
      for (let i = o; i < o + win; i++) s += p.samples[i] * p.samples[i];
      if (20 * Math.log10(Math.sqrt(s / win) / 32768 + 1e-9) > -45) voiced += 0.02;
    }
    const tail = p.samples.subarray(Math.max(0, p.samples.length - Math.round(p.rate * 0.04)));
    let ts = 0;
    for (const v of tail) ts += v * v;
    const tailDb = 20 * Math.log10(Math.sqrt(ts / Math.max(1, tail.length)) / 32768 + 1e-9);
    const rate = voiced > 0.3 ? syllableCount(texts[k] ?? '') / voiced : null;
    return { segment: k, speech_rate_syll_per_s: rate == null ? null : Number(rate.toFixed(2)), rate_flag: rate == null ? null : rate < 3.2 ? 'too_slow' : rate > 7.5 ? 'too_fast' : null, truncated_end: tailDb > -35, tail_dbfs: Number(tailDb.toFixed(1)) };
  });
}
