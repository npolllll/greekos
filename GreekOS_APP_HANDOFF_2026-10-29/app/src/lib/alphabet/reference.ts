/**
 * Alphabet reference derived ONLY from the canonical theory of U-A1-007 ("Алфавит: от написания к
 * чтению"). Letters and names are parsed from its "Полный справочник" line; sounds are shown only
 * where that theory states them; example words are the Greek words that theory and its examples use.
 * Nothing here is authored by the app: if the unit text changes, the page follows it.
 */
export const ALPHABET_UNIT = 'U-A1-007';
export const STRESS_UNIT = 'U-A1-008';

export interface Letter { upper: string; lower: string; final: string | null; name: string; sound: string | null; examples: string[] }
export interface Digraph { key: string; letters: string; sound: string; note_ru: string; examples: string[] }

/** Sounds stated verbatim in the U-A1-007 theory ("α=[a], ε=[e], η/ι/υ=[i], ο/ω=[o]", "β — [v], ζ — [z], φ — [f]", "Ξ … [ks], ψ — [ps]"). */
const STATED_SOUND: Record<string, string> = { α: '[a]', ε: '[e]', η: '[i]', ι: '[i]', υ: '[i]', ο: '[o]', ω: '[o]', β: '[v]', ζ: '[z]', φ: '[f]', ξ: '[ks]', ψ: '[ps]' };

/** Digraphs exactly as the theory groups them; sounds are the theory's. Examples are filtered against the theory text below. */
const DIGRAPHS: Digraph[] = [
  { key: 'αι', letters: 'αι', sound: '[e]', note_ru: 'Читается как одна гласная. Две точки (διαλυτικά) показывают раздельное чтение: Μαΐου.', examples: ['παιδί', 'είναι', 'Μαΐου'] },
  { key: 'ει', letters: 'ει · οι · υι', sound: '[i]', note_ru: 'Одна гласная [i]. Ударение над второй буквой относится ко всему сочетанию.', examples: ['είναι'] },
  { key: 'ου', letters: 'ου', sound: '[u]', note_ru: 'Одна гласная [u].', examples: ['που', 'ακούω'] },
  { key: 'μπ', letters: 'μπ', sound: '[b]', note_ru: 'Звонкое [b]; внутри слова возможен носовой компонент [mb].', examples: ['μπαμπάς'] },
  { key: 'ντ', letters: 'ντ', sound: '[d]', note_ru: 'Звонкое [d]; внутри слова возможно [nd].', examples: ['ντομάτα'] },
  { key: 'γκ', letters: 'γκ · γγ', sound: '[g]', note_ru: 'Звонкое [g]; γγ тоже связано со звуком [g], возможно [ŋg].', examples: ['γκολ', 'φεγγάρι'] },
  { key: 'αυ', letters: 'αυ · ευ', sound: '[af]/[av] · [ef]/[ev]', note_ru: 'Зависит от следующего звука. Запоминайте пары целых слов, а не правило «перед буквой».', examples: ['αυτό', 'αύριο', 'ευχαριστώ', 'ευγενικός'] },
];

const GREEK_WORD = /[\p{Script=Greek}][\p{Script=Greek}́̈]*/gu;
const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ς/g, 'σ');

/** Greek words (≥2 letters) that the unit theory and its examples actually use, in order of appearance. */
export function lessonWords(theory: string, examples: string[]): string[] {
  const out: string[] = [];
  for (const src of [theory, ...examples]) for (const m of src.normalize('NFC').matchAll(GREEK_WORD)) {
    const w = m[0];
    if ([...w].length < 2 || out.includes(w)) continue;
    out.push(w);
  }
  return out;
}

export function parseAlphabet(theory: string, examples: string[]): { letters: Letter[]; digraphs: Digraph[]; words: string[] } {
  const t = theory.normalize('NFC');
  const ref = t.slice(t.indexOf('Полный справочник'));
  const line = ref.slice(0, ref.indexOf('\n') > 0 ? ref.indexOf('\n') : undefined);
  const words = lessonWords(t, examples);
  const names = new Set<string>();
  const letters: Letter[] = [];
  for (const m of line.matchAll(/(\p{Lu})\s+(\p{Ll})(?:\/(\p{Ll}))?\s+([\p{Script=Greek}́]+)/gu)) {
    const [, upper, lower, final, name] = m;
    names.add(name);
    letters.push({ upper, lower, final: final ?? null, name, sound: STATED_SOUND[lower] ?? null, examples: [] });
  }
  // Example words for a letter: lesson words (not letter names, not bare digraphs like «αι», «Μπ») that contain it, shortest first.
  const pool = words.filter((w) => !names.has(w) && [...w].length >= 3);
  for (const l of letters) {
    const k = strip(l.lower);
    l.examples = pool.filter((w) => strip(w).includes(k)).sort((a, b) => a.length - b.length).slice(0, 3);
  }
  const lw = new Set(words);
  const digraphs = DIGRAPHS.map((d) => ({ ...d, examples: d.examples.filter((e) => lw.has(e)) }));
  return { letters, digraphs, words };
}
