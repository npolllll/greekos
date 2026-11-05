import 'server-only';
import { createHash } from 'node:crypto';
import { synthesizeWithVoice, type SpeedProfile } from '../providers/speech.ts';
import { localAsrHealth, localTranscribe } from '../providers/local-engines.ts';
import { analyzeWav, parseWav, pcmSamples } from '../audio/wav.ts';
import { alignmentDiff, roundTrip, segmentSignals } from '../audio/roundtrip.ts';
import { loadCatalog, type CatalogVoice } from './catalog.ts';
import { env } from '../env.ts';

/**
 * Original benchmark phrases (not course content): greetings, numbers, dates, questions with the
 * Greek «;», stress minimal pairs, consonant clusters, names and toponyms (v5.4 §3), loanwords.
 */
export const BENCH_PHRASES: Array<{ id: string; text: string; focus: string }> = [
  { id: 'P01', text: 'Καλημέρα σας! Τι κάνετε σήμερα;', focus: 'greeting, question' },
  { id: 'P02', text: 'Θα πάμε αύριο στη Θεσσαλονίκη ή στην Αθήνα;', focus: 'toponyms, alternative question' },
  { id: 'P03', text: 'Ο ΠΑΟΚ παίζει απόψε στις εννιά και μισή.', focus: 'acronym, time' },
  { id: 'P04', text: 'Πότε φεύγει το τρένο; Δεν έχω πάει ποτέ με τρένο.', focus: 'stress pair πότε/ποτέ' },
  { id: 'P05', text: 'Πού είναι το βιβλίο που μου έδωσες;', focus: 'stress pair πού/που' },
  { id: 'P06', text: 'Μπορείτε να το πείτε λίγο πιο αργά, παρακαλώ;', focus: 'polite request' },
  { id: 'P07', text: 'Θέλω ένα κιλό μήλα και δύο κιλά ντομάτες.', focus: 'numbers, clusters ντ' },
  { id: 'P08', text: 'Η εκστρατεία ξεκίνησε στις δεκαπέντε Μαρτίου.', focus: 'cluster κστρ, date' },
  { id: 'P09', text: 'Ο Γιώργος και η Ελένη μένουν στην Πάτρα.', focus: 'personal names, toponym' },
  { id: 'P10', text: 'Συγγνώμη, πού είναι η στάση του λεωφορείου;', focus: 'γγ, directions' },
  { id: 'P11', text: 'Το διαμέρισμα έχει δύο υπνοδωμάτια και μεγάλο μπαλκόνι.', focus: 'long words, μπ' },
  { id: 'P12', text: 'Δεν ξέρω αν θα έρθω, γιατί έχω πολλή δουλειά.', focus: 'negation, conjunctions' },
  { id: 'P13', text: 'Ναι, καλά. Θα σε πάρω τηλέφωνο το απόγευμα.', focus: 'colloquial ναι καλά' },
  { id: 'P14', text: 'Το εισιτήριο κοστίζει δεκαοχτώ ευρώ και πενήντα λεπτά.', focus: 'prices' },
  { id: 'P15', text: 'Έχετε κράτηση; Για πόσα άτομα;', focus: 'short questions' },
  { id: 'P16', text: 'Ο γιατρός είπε να παίρνω το φάρμακο δύο φορές την ημέρα.', focus: 'pharmacy, frequency' },
  { id: 'P17', text: 'Η Ακρόπολη και ο Λευκός Πύργος είναι πολύ γνωστά μνημεία.', focus: 'landmarks' },
  { id: 'P18', text: 'Μου αρέσει να διαβάζω, αλλά δεν έχω χρόνο.', focus: 'clitics' },
  { id: 'P19', text: 'Πήγα στο σούπερ μάρκετ και αγόρασα καφέ και ψωμί.', focus: 'loanwords, ψ' },
  { id: 'P20', text: 'Τον Αύγουστο το Αιγαίο έχει πολύ αέρα.', focus: 'diphthongs αυ/αι' },
  { id: 'P21', text: 'Αν βρέξει, θα μείνουμε σπίτι και θα δούμε ταινία.', focus: 'conditional' },
  { id: 'P22', text: 'Χθες το βράδυ φάγαμε σε μια ταβέρνα στην Πλάκα.', focus: 'χθ cluster, past' },
  { id: 'P23', text: 'Ευχαριστώ πολύ για τη βοήθεια! Να είστε καλά.', focus: 'ευ, thanks' },
  { id: 'P24', text: 'Μπορώ να πληρώσω με κάρτα ή μόνο με μετρητά;', focus: 'payment, alternative question' },
  { id: 'P25', text: 'Το γραφείο είναι στον τρίτο όροφο, δεξιά από το ασανσέρ.', focus: 'ordinals, loanword' },
  { id: 'P26', text: 'Ρε συ, πού χάθηκες; Έχουμε καιρό να τα πούμε!', focus: 'informal ρε, Real Greek' },
  { id: 'P27', text: 'Η συνάντηση μεταφέρθηκε για την Πέμπτη στις δέκα.', focus: 'φθ cluster, schedule' },
  { id: 'P28', text: 'Θα ήθελα να ανοίξω λογαριασμό στην τράπεζα.', focus: 'bank, θα ήθελα' },
  { id: 'P29', text: 'Ο Νίκος σπουδάζει ψυχολογία στο Ηράκλειο.', focus: 'ψ, toponym' },
  { id: 'P30', text: 'Όχι, δεν είναι αυτό. Εννοούσα το άλλο, το μπλε.', focus: 'correction, contrast' },
];

export interface BenchRow {
  voice_id: string;
  phrase_id: string;
  speed: SpeedProfile;
  synth_ms: number;
  duration_ms: number | null;
  rtf: number | null;
  technical_pass: boolean | null;
  peak_dbfs: number | null;
  clipping_ratio: number | null;
  speech_rate_syll_per_s: number | null;
  rate_flag: string | null;
  truncated_end: boolean | null;
  asr_text: string | null;
  wer: number | null;
  cer: number | null;
  accent_mismatches: string[];
  missing: string[];
  audio_sha256: string | null;
  error: string | null;
}

const pct = (v: number[], p: number) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] : null; };

/** Synthesizes the benchmark set with every available catalog voice and measures it (no uploads). */
export async function runTtsBenchmark(opts: { speeds?: SpeedProfile[]; speedSubset?: number; actorId?: string | null } = {}) {
  const voices = [...(await loadCatalog()).values()].filter((v) => v.available && v.provider !== 'mock');
  const asr = env.localEnginesAllowed ? await localAsrHealth() : null;
  const useAsr = !!asr?.available.includes('medium');
  const rows: BenchRow[] = [];
  for (const v of voices) {
    for (const speed of opts.speeds ?? (['normal', 'slow', 'fast'] as SpeedProfile[])) {
      const phrases = speed === 'normal' ? BENCH_PHRASES : BENCH_PHRASES.slice(0, opts.speedSubset ?? 10);
      for (const p of phrases) rows.push(await benchOne(v, p, speed, useAsr, opts.actorId ?? null));
    }
  }
  const summary = voices.map((v) => {
    const r = rows.filter((x) => x.voice_id === v.voice_id && !x.error);
    const normal = r.filter((x) => x.speed === 'normal');
    const rate = (s: SpeedProfile) => { const xs = r.filter((x) => x.speed === s && x.speech_rate_syll_per_s != null).map((x) => x.speech_rate_syll_per_s!); return xs.length ? Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2)) : null; };
    return {
      voice_id: v.voice_id, provider: v.provider, presentation: v.presentation, presentation_source: v.presentation_source, quality_tier: v.quality_tier,
      distribution_allowed: v.distribution_allowed, samples: r.length, errors: rows.filter((x) => x.voice_id === v.voice_id && x.error).length,
      synth_ms_p50: pct(normal.map((x) => x.synth_ms), 0.5), synth_ms_p95: pct(normal.map((x) => x.synth_ms), 0.95),
      rtf_p50: pct(normal.filter((x) => x.rtf != null).map((x) => x.rtf!), 0.5),
      technical_pass_ratio: r.length ? Number((r.filter((x) => x.technical_pass).length / r.length).toFixed(3)) : null,
      mean_rate_syll_per_s: { normal: rate('normal'), slow: rate('slow'), fast: rate('fast') },
      asr_wer_mean_normal: useAsr && normal.length ? Number((normal.reduce((a, x) => a + (x.wer ?? 0), 0) / normal.length).toFixed(3)) : null,
      asr_cer_mean_normal: useAsr && normal.length ? Number((normal.reduce((a, x) => a + (x.cer ?? 0), 0) / normal.length).toFixed(3)) : null,
      phrases_with_accent_mismatch: normal.filter((x) => x.accent_mismatches.length).map((x) => x.phrase_id),
      truncated_endings: r.filter((x) => x.truncated_end).length,
    };
  });
  return { generated_at: new Date().toISOString(), asr_engine: useAsr ? 'local:faster-whisper-medium-int8' : null, phrases: BENCH_PHRASES, summary, rows };
}

async function benchOne(v: CatalogVoice, p: { id: string; text: string }, speed: SpeedProfile, useAsr: boolean, actorId: string | null): Promise<BenchRow> {
  const base: BenchRow = { voice_id: v.voice_id, phrase_id: p.id, speed, synth_ms: 0, duration_ms: null, rtf: null, technical_pass: null, peak_dbfs: null, clipping_ratio: null, speech_rate_syll_per_s: null, rate_flag: null, truncated_end: null, asr_text: null, wer: null, cer: null, accent_mismatches: [], missing: [], audio_sha256: null, error: null };
  try {
    const t0 = Date.now();
    const audio = await synthesizeWithVoice(p.text, v, { speed, userId: actorId, operation: 'tts_benchmark' });
    base.synth_ms = Date.now() - t0;
    const tech = analyzeWav(audio.bytes);
    const info = parseWav(audio.bytes);
    const [sig] = segmentSignals([p.text], [audio.bytes], (b) => (info ? { samples: pcmSamples(b, info), rate: info.sampleRate } : null));
    Object.assign(base, {
      duration_ms: tech?.duration_ms ?? null, rtf: tech?.duration_ms ? Number((base.synth_ms / tech.duration_ms).toFixed(3)) : null,
      technical_pass: tech?.pass ?? null, peak_dbfs: tech ? Number(tech.peak_dbfs.toFixed(1)) : null, clipping_ratio: tech?.clipping_ratio ?? null,
      speech_rate_syll_per_s: sig?.speech_rate_syll_per_s ?? null, rate_flag: sig?.rate_flag ?? null, truncated_end: sig?.truncated_end ?? null,
      audio_sha256: createHash('sha256').update(audio.bytes).digest('hex'),
    });
    if (useAsr) {
      const r = await localTranscribe(audio.bytes, 'medium', 120_000);
      const m = roundTrip(p.text, r.text);
      Object.assign(base, { asr_text: r.text, wer: m.wer, cer: m.cer_accent_insensitive, accent_mismatches: m.accent_mismatches, missing: alignmentDiff(p.text, r.text).missing });
    }
  } catch (e) {
    base.error = (e as Error).message.slice(0, 200);
  }
  return base;
}
