/**
 * Guard for Greek produced by a language model before a learner hears or reads it. It is a filter,
 * not a validation of quality: it rejects text that is not Greek, contains words hunspell el_GR does
 * not know (except names and vocabulary of the scenario), or is too long for the level, and repairs
 * one frequent, unambiguous agreement error of small models (numeral gender: «τρεις ευρώ» → «τρία ευρώ»).
 */
import { greekLetterRatio } from '../scoring/normalize.ts';
import { unknownGreekWords } from '../qa/run.ts';

export interface GuardResult {
  ok: boolean;
  text: string;
  fixes: string[];
  problems: string[];
}

const WORD = /[\p{Script=Greek}]+(?:['’][\p{Script=Greek}]+)?/gu;
const MAX_WORDS: Record<string, number> = { A0: 22, A1: 26, A2: 36, B1: 50, B2: 70 };

/** All Greek word forms of a text, lower-cased NFC (for dictionaries and allow-lists). */
export function greekWords(text: string): string[] {
  return (text.normalize('NFC').match(WORD) ?? []).map((w) => w.toLowerCase());
}

const NEUTER_PLURAL = /^(ευρώ|[\p{Script=Greek}]+[αά])$/u;
const MASC_FEM_PLURAL = /^[\p{Script=Greek}]+(ες|ές|οι|είς|εις)$/u;

// Frequent masculine nouns of the course scenes in the accusative singular that begin with a vowel or
// κ, π, τ — where the final -ν of «έναν» is obligatory (έναν καφέ, έναν αριθμό). «ένα» before them is an
// error small models often echo from the learner. (Before other consonants «ένα χρόνο» is accepted.)
const MASC_ACC = new Set(['καφέ', 'κωδικό', 'καθηγητή', 'κήπο', 'πελάτη', 'πίνακα', 'πωλητή', 'τεχνικό', 'τόνο', 'υπάλληλο', 'οδηγό', 'αριθμό', 'όροφο', 'ήλιο', 'άνθρωπο', 'ακροατή', 'επιβάτη']);

/** Numeral gender agreement with the following noun (3 and 4 have neuter forms; 1 with ευρώ). */
export function fixNumeralAgreement(text: string): { text: string; fixes: string[] } {
  const fixes: string[] = [];
  const out = text.replace(/(?<!\p{L})(τρεις|τέσσερις|τρία|τέσσερα|ένας|ένα|μία|μια)(\s+)([\p{Script=Greek}]+)/giu, (all, num: string, sp: string, noun: string) => {
    const n = num.toLowerCase();
    const w = noun.toLowerCase();
    const keepCase = (to: string) => (num[0] === num[0].toUpperCase() ? to[0].toUpperCase() + to.slice(1) : to);
    let to: string | null = null;
    if ((n === 'τρεις' || n === 'τέσσερις') && NEUTER_PLURAL.test(w)) to = n === 'τρεις' ? 'τρία' : 'τέσσερα';
    else if ((n === 'τρία' || n === 'τέσσερα') && MASC_FEM_PLURAL.test(w) && w !== 'ευρώ') to = n === 'τρία' ? 'τρεις' : 'τέσσερις';
    else if ((n === 'ένας' || n === 'μία' || n === 'μια') && w === 'ευρώ') to = 'ένα';
    else if (n === 'ένα' && MASC_ACC.has(w)) to = 'έναν';
    if (!to) return all;
    fixes.push(`${num} ${noun} → ${keepCase(to)} ${noun}`);
    return `${keepCase(to)}${sp}${noun}`;
  });
  return { text: out, fixes };
}

/**
 * Checks one sentence (or a whole reply) of generated Greek. `allowed` holds lower-cased word forms
 * that are fine even if hunspell does not know them (names, scenario vocabulary, the persona's name).
 */
export async function guardGreek(textIn: string, opts: { level?: string | null; allowed?: Set<string>; maxWords?: number } = {}): Promise<GuardResult> {
  const problems: string[] = [];
  const { text, fixes } = fixNumeralAgreement(textIn.normalize('NFC').replace(/\s+/g, ' ').trim());
  if (!text) return { ok: false, text, fixes, problems: ['EMPTY'] };
  if (/\p{Script=Cyrillic}/u.test(text)) problems.push('CYRILLIC');
  if (/[{}[\]<>\\|_#*=]/.test(text)) problems.push('MARKUP');
  const latin = (text.match(/[A-Za-z]{2,}/g) ?? []).filter((w) => !/^(OK|ok)$/.test(w));
  if (latin.length) problems.push(`LATIN:${latin.slice(0, 3).join(',')}`);
  if (greekLetterRatio(text) < 0.85) problems.push('NOT_GREEK');
  const words = greekWords(text);
  const limit = opts.maxWords ?? MAX_WORDS[(opts.level ?? 'B1').slice(0, 2)] ?? 50;
  if (words.length > limit) problems.push(`TOO_LONG:${words.length}>${limit}`);
  const candidates = new Set(words.filter((w) => !opts.allowed?.has(w)));
  if (candidates.size) {
    const { unknown } = await unknownGreekWords(candidates);
    if (unknown) {
      // Capitalised mid-sentence words are names; everything else must be in the dictionary.
      const caps = new Set((text.match(WORD) ?? []).filter((w, i) => i > 0 && w[0] === w[0].toUpperCase()).map((w) => w.toLowerCase()));
      const bad = [...unknown].filter((w) => !caps.has(w));
      if (bad.length) problems.push(`SPELLING:${bad.slice(0, 4).join(',')}`);
    }
  }
  return { ok: problems.length === 0, text, fixes, problems };
}
