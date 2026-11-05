/** Normalisation strictly limited to what an item's policy permits (Greek accents preserved). */
export type NormalizationStep = 'NFC' | 'trim' | 'casefold' | 'collapse_whitespace';

export const DEFAULT_STEPS: NormalizationStep[] = ['NFC', 'trim', 'casefold', 'collapse_whitespace'];

export function normalizeByPolicy(input: string, steps: readonly string[] = DEFAULT_STEPS): string {
  let s = input;
  if (steps.includes('NFC')) s = s.normalize('NFC');
  if (steps.includes('collapse_whitespace')) s = s.replace(/\s+/gu, ' ');
  if (steps.includes('trim')) s = s.trim();
  // Case-insensitive, but final sigma stays meaningful: String#toLowerCase applies the Unicode
  // Final_Sigma rule (ΝΙΚΟΣ → νικος), so ς/σ are NOT merged — writing σ at the end is an error.
  if (steps.includes('casefold')) s = s.toLowerCase();
  return s;
}

/** Both sigma forms mapped to one: used ONLY to detect a sigma-form-only difference, never to accept. */
export function foldSigma(s: string): string {
  return s.replace(/ς/g, 'σ');
}

/** Removes combining diacritics — used ONLY to detect accent-only differences, never to accept. */
export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');
}

const TYPOGRAPHIC: Array<[RegExp, string]> = [
  [/[‘’ʼ΄᾽᾿`´]/gu, "'"],
  [/[“”«»„]/gu, '"'],
  [/[–—−]/gu, '-'],
  [/…/gu, '...'],
];

/** Maps typographic variants (curly apostrophes, guillemets, dashes) to plain forms. */
export function typographic(s: string): string {
  return TYPOGRAPHIC.reduce((acc, [re, rep]) => acc.replace(re, rep), s);
}

/** Drops surrounding/sentence punctuation but keeps word-internal apostrophes. */
export function stripPunctuation(s: string): string {
  return s
    .replace(/[.,;:!?·«»"()[\]…;·]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function greekLetterRatio(s: string): number {
  const letters = s.match(/\p{L}/gu) ?? [];
  if (!letters.length) return 0;
  const greek = letters.filter((c) => /[Ͱ-Ͽἀ-῿]/u.test(c));
  return greek.length / letters.length;
}

export function wordCount(s: string): number {
  return (s.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
}
