/**
 * Spoken form of Greek text for the voice (TTS input only; what the learner reads never changes).
 *
 * The Azure Greek voices spell out some written forms instead of reading them. Found on the course audio
 * by two independent recognisers (Azure and Whisper) and confirmed by a probe on 15.11.2026:
 *   «Γι’ αυτό»     → read «γάμα γιώτα, αυτό»      → spoken «Γιαυτό»     (both recognisers then read «γι’ αυτό»)
 *   «στ’ αλήθεια»  → read «σίγμα ταυ αλήθεια»     → spoken «σταλήθεια»
 *   «συνάδελφός μου» (two accent marks) → stressed on -δέλ- → spoken «συνάδελφος μου»
 *   «Α, καλά…» (interjection) → read «άλφα»; «νι» in spelling → read «νι γιώτα» (phoneme tags, see below)
 * Each rule is narrow and tested; nothing else in the text is touched.
 */
const VOWEL = 'αάεέηήιίοόυύωώϊϋΐΰΑΆΕΈΗΉΙΊΟΌΥΎΩΏ';
const APOS = '[’\'ʼ]';

const RULES: Array<{ id: string; re: RegExp; to: string }> = [
  // Elided «γι’» before a vowel: written together it is read as one word ([ʝa]).
  { id: 'elision.gi', re: new RegExp(`(^|[^\\p{L}])([Γγ])ι${APOS}\\s+(?=[${VOWEL}])`, 'gu'), to: '$1$2ι' },
  // Elided «στ’» before a vowel (στ’ αλήθεια, στ’ όνειρό μου).
  { id: 'elision.st', re: new RegExp(`(^|[^\\p{L}])([Σσ])τ${APOS}\\s+(?=[${VOWEL}])`, 'gu'), to: '$1$2τ' },
];

/** Words whose enclitic second accent mark makes the voice move the stress. */
const LEXICON: Record<string, string> = {
  'συνάδελφός': 'συνάδελφος',
};

export function spokenForm(text: string): string {
  let t = text.normalize('NFC');
  for (const r of RULES) t = t.replace(r.re, r.to);
  t = t.replace(/[\p{L}]+/gu, (w) => LEXICON[w] ?? LEXICON[w.toLowerCase()] ?? w);
  return t;
}

/**
 * SSML-level rules on already-escaped text (forms only a phoneme tag reads right; probe 2, 15.11.2026):
 *   interjection «Α,» at the start of a sentence → read «άλφα»; with an IPA [a] both recognisers read «α»
 *   letter name «νι» in spelling («Άλφα, νι, νι, άλφα») → read «νι γιώτα»; with IPA [ni] it is the letter name
 * «Α» as a label («Επιλέξτε Α, Β ή Γ») is not at a sentence start and stays «άλφα».
 */
const PH = (text: string, ipa: string) => `<phoneme alphabet="ipa" ph="${ipa}">${text}</phoneme>`;

/**
 * Contrastive focus that a task asks the learner to hear (prosody, not wording). In these recordings one
 * sentence is said in versions that differ only by which word is stressed, and the voice read them alike, so
 * the tasks could not be solved by ear. The Azure Greek voices ignore <emphasis>. A raised, slower and louder
 * focus word gives the contrast: on probe 2, 15.11.2026, the focus word was 4.3–4.7 semitones higher and
 * longer in the version that stresses it, and both recognisers still read the script. Versions in one file
 * are separated by a pause. Whether it sounds natural is for a native listener.
 * Keyed by recording: the same sentence carries a different focus in different files.
 */
export const FOCUS_BY_AUDIO: Record<string, string[]> = {
  // U-B2-016-I12: version 1 — who (Μαρία), version 2 — when (αύριο).
  'U-B2-016-I12-AUDIO': ['Μαρία', 'αύριο'],
  // U-B1-021-I03/I04: track A corrects who brings the tickets (Άννα, not Πέτρος), track B — when (αύριο, not today).
  'U-B1-021-AUD01': ['Άννα'],
  'U-B1-021-AUD02': ['αύριο'],
};
const F_OPEN = '\u27EA';
const F_CLOSE = '\u27EB';
const F_BREAK = '\u27C2';
const FOCUS_PROSODY = '<prosody pitch="+25%" rate="-15%" volume="+30%">';

/** What the voice reads for a recording with a contrastive focus: the focus word of each sentence marked. */
export function focusText(audioId: string, text: string): string {
  const focus = FOCUS_BY_AUDIO[audioId];
  if (!focus) return text;
  const versions = text.split(/(?<=\.)\s+/u);
  if (versions.length !== focus.length) return text;
  return versions
    .map((v, i) => v.replace(new RegExp(`(^|[^\\p{L}])(${focus[i]})(?=[^\\p{L}]|$)`, 'u'), `$1${F_OPEN}$2${F_CLOSE}`))
    .join(` ${F_BREAK}`);
}

/** The text without focus marks (for engines that take plain text, and for the recogniser's reference). */
export function plainText(text: string): string {
  return text.replaceAll(F_OPEN, '').replaceAll(F_CLOSE, '').replaceAll(` ${F_BREAK}`, ' ').replaceAll(F_BREAK, '');
}

export function spokenSsmlMarkup(escaped: string): string {
  return escaped
    .replaceAll(F_OPEN, FOCUS_PROSODY).replaceAll(F_CLOSE, '</prosody>').replaceAll(F_BREAK, '<break time="800ms"/>')
    .replace(/(^|[.!;?…]\s+|«)([Αα])(?=\s*[,!…])/gu, (_m, pre: string, a: string) => `${pre}${PH(a, 'a')}`)
    .replace(/(^|[\s,.—–-])([Νν]ι)(?=[\s,.—–-]|$)/gu, (_m, pre: string, ni: string) => `${pre}${PH(ni, 'ni')}`);
}

/** The spoken form when it differs from the text (part of a course file's render key), else null. */
export function spokenKey(text: string): string | null {
  const f = spokenSsmlMarkup(spokenForm(text));
  return f === text ? null : f;
}
