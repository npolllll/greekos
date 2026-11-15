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
export function spokenSsmlMarkup(escaped: string): string {
  return escaped
    .replace(/(^|[.!;?…]\s+|«)([Αα])(?=\s*[,!…])/gu, (_m, pre: string, a: string) => `${pre}${PH(a, 'a')}`)
    .replace(/(^|[\s,.—–-])([Νν]ι)(?=[\s,.—–-]|$)/gu, (_m, pre: string, ni: string) => `${pre}${PH(ni, 'ni')}`);
}

/** The spoken form when it differs from the text (part of a course file's render key), else null. */
export function spokenKey(text: string): string | null {
  const f = spokenSsmlMarkup(spokenForm(text));
  return f === text ? null : f;
}
