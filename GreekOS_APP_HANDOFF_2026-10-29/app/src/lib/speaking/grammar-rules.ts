/**
 * Deterministic grammar rules of the course for the learner's phrase (and for the persona's own
 * replies): the frequent A1–B1 errors with one certain correction. Every rule is conservative — a form
 * it proposes must exist in the el_GR dictionary (hunspell), and a word is treated as a masculine noun
 * or a neuter noun only when the dictionary confirms it — so that a correct phrase is never "fixed".
 * scripts/rules-on-corpus.ts runs all rules over the course's own vetted Greek to measure false hits.
 *
 * Rules (id → what it fixes):
 *  se_article   σε το / σε την → στο / στην (the preposition merges with the article)
 *  modal_na     πρέπει φτάνω / θέλω πάω → πρέπει να φτάνω / θέλω να πάω
 *  pronoun_verb εγώ θέλει → εγώ θέλω; εσύ θέλω → εσύ θέλεις
 *  number_plural δύο κιλό πορτοκάλι → δύο κιλά πορτοκάλια (neuter nouns after a number > 1)
 *  masc_article στο / το Λευκό Πύργο → στον / τον Λευκό Πύργο (masculine accusative keeps -ν)
 *  numeral      ένα καφέ → έναν καφέ, τρεις ευρώ → τρία ευρώ (see greek-guard fixNumeralAgreement)
 */
import { CLOSED_CLASS, fixNumeralAgreement, MASC_ACC } from './greek-guard.ts';
import { unknownGreekWords } from '../qa/run.ts';

export interface RuleFinding { rule: string; start: number; end: number; quote: string; better_el: string; why_ru: string }

const WORD = /[\p{L}\p{M}]+/gu;
const lower = (w: string) => w.toLowerCase();
const keepCase = (from: string, to: string) => (from[0] && from[0] !== from[0].toLowerCase() ? to[0].toUpperCase() + to.slice(1) : to);

// Frequent masculine nouns whose accusative the dictionary test cannot tell from an adjective or a
// feminine form (φίλο/φίλη, σταθμό/σταθμή): for the (σ)τον rule only.
const COMMON_MASC_ACC = new Set(['σταθμό', 'φίλο', 'γιατρό', 'δάσκαλο', 'αδερφό', 'αδελφό', 'γείτονα', 'θείο', 'σκύλο', 'φοιτητή', 'μαθητή', 'πατέρα', 'άντρα', 'σερβιτόρο', 'ταξιτζή', 'δρόμο', 'καιρό', 'λογαριασμό', 'χυμό', 'φούρνο', 'κινηματογράφο', 'πύργο', 'Πύργο', 'Λευκό Πύργο']);
const ARTICLE_AFTER_SE: Record<string, string> = { το: 'στο', τον: 'στον', την: 'στην', τη: 'στη', τα: 'στα', τους: 'στους', τις: 'στις' };
const MODALS = new Set(['πρέπει', 'θέλω', 'θέλεις', 'θέλει', 'θέλουμε', 'θέλετε', 'θέλουν', 'θέλουνε', 'μπορώ', 'μπορείς', 'μπορεί', 'μπορούμε', 'μπορείτε', 'μπορούν', 'μπορούνε']);
const VERB_END = /(ω|ώ|ουμε|ούμε|ετε|είτε|ουν|ούν|ουνε|εις|είς|ει|εί|άς|άει|άμε|άτε|άνε|ομαι|ιέμαι|ούμαι|εσαι|εται|όμαστε|εστε|ονται)$/u;
const NOT_VERBS = new Set(['εκεί', 'πού', 'που', 'πώς', 'πως', 'ποτέ', 'ίσως', 'μαζί', 'αύριο', 'σήμερα', 'τώρα', 'πολύ', 'λίγο', 'πάντα', 'ακόμα', 'ακόμη', 'εγώ', 'εσύ', 'εσείς', 'εμείς', 'αυτοί', 'κάτι', 'τίποτα', 'τίποτε', 'πάλι', 'ευχαριστώ', 'μπορεί', 'ναι', 'όχι', 'πρέπει', 'αυτό', 'εδώ', 'μετά', 'πριν', 'απόψε', 'χθες', 'χτες', 'φέτος', 'πέρσι', 'καλά', 'καλή', 'καλό', 'ηχώ']);
const NUMBERS = new Set(['δύο', 'τρία', 'τέσσερα', 'πέντε', 'έξι', 'επτά', 'εφτά', 'οκτώ', 'οχτώ', 'εννέα', 'εννιά', 'δέκα', 'έντεκα', 'δώδεκα', 'είκοσι', 'τριάντα', 'σαράντα', 'πενήντα', 'εκατό', 'πολλά', 'λίγα', 'μερικά', 'κάμποσα']);

/** Neuter plural of a singular in -ο/-ό/-ι/-ί (κιλό → κιλά, μήλο → μήλα, πορτοκάλι → πορτοκάλια, παιδί → παιδιά). */
function neuterPlural(w: string): string | null {
  if (/ο$/u.test(w)) return `${w.slice(0, -1)}α`;
  if (/ό$/u.test(w)) return `${w.slice(0, -1)}ά`;
  if (/ι$/u.test(w)) return `${w}α`;
  if (/ί$/u.test(w)) return `${w.slice(0, -1)}ιά`;
  return null;
}
const masculineNom = (w: string) => (/[οό]$/u.test(w) ? `${w}ς` : null);
const feminineAdj = (w: string) => (/ο$/u.test(w) ? `${w.slice(0, -1)}η` : /ό$/u.test(w) ? `${w.slice(0, -1)}ή` : null);

/** Collects every dictionary form the rules may ask about for this text. */
export function candidates(words: string[]): Set<string> {
  const out = new Set<string>();
  for (const raw of words) {
    const w = lower(raw);
    out.add(w);
    for (const f of [neuterPlural(w), masculineNom(w), feminineAdj(w), w.endsWith('ει') ? `${w.slice(0, -2)}ω` : null, w.endsWith('εί') ? `${w.slice(0, -2)}ώ` : null, w.endsWith('ω') ? `${w.slice(0, -1)}εις` : null, w.endsWith('ώ') ? `${w.slice(0, -1)}είς` : null]) if (f) out.add(f);
  }
  return out;
}

// Dictionary answers are cached for the life of the process (a hunspell start loads the whole el_GR
// dictionary, ≈ 0.3 s); null = no dictionary on this machine.
const lexicon = new Map<string, boolean>();
let noDictionary = false;

/** Looks up every form not yet cached in one hunspell call. */
export async function primeLexicon(words: Iterable<string>): Promise<void> {
  const missing = new Set([...words].map(lower).filter((w) => /\p{Script=Greek}/u.test(w) && !lexicon.has(w)));
  if (!missing.size || noDictionary) return;
  const { unknown } = await unknownGreekWords(missing);
  if (!unknown) { noDictionary = true; return; }
  for (const w of missing) lexicon.set(w, !unknown.has(w));
}

/** All rule findings in a text, in order of appearance (overlaps resolved: the first wins). */
export async function courseRuleFindings(textIn: string): Promise<RuleFinding[]> {
  const text = textIn.normalize('NFC');
  const toks = [...text.matchAll(WORD)].map((m) => ({ w: m[0], l: lower(m[0]), start: m.index!, end: m.index! + m[0].length }));
  if (!toks.length || !toks.some((t) => /\p{Script=Greek}/u.test(t.w))) return [];
  await primeLexicon(candidates(toks.map((t) => t.w)));
  // Without a dictionary only the rules that need none run.
  const known = (w: string) => lexicon.get(lower(w)) === true;
  const isMascNoun = (w: string) => !CLOSED_CLASS.has(lower(w)) && (MASC_ACC.has(lower(w)) || COMMON_MASC_ACC.has(lower(w)) || (!!masculineNom(lower(w)) && known(masculineNom(lower(w))!) && !known(neuterPlural(lower(w)) ?? '') && !known(feminineAdj(lower(w)) ?? '')));
  const isAdjOnO = (w: string) => !!masculineNom(lower(w)) && known(masculineNom(lower(w))!) && known(feminineAdj(lower(w)) ?? '');
  const isNeuterNoun = (w: string) => !CLOSED_CLASS.has(lower(w)) && !!neuterPlural(lower(w)) && known(neuterPlural(lower(w))!) && !(masculineNom(lower(w)) && known(masculineNom(lower(w))!)) && known(lower(w));
  const span = (a: number, b: number) => text.slice(toks[a].start, toks[b].end);
  const found: RuleFinding[] = [];
  const add = (f: RuleFinding) => { if (!found.some((x) => f.start < x.end && x.start < f.end)) found.push(f); };

  for (let i = 0; i < toks.length - 1; i++) {
    const t = toks[i];
    const n = toks[i + 1];
    const gap = text.slice(t.end, n.start);
    if (!/^\s+$/.test(gap)) continue;
    // σε + article
    if (t.l === 'σε' && ARTICLE_AFTER_SE[n.l]) {
      add({ rule: 'se_article', start: t.start, end: n.end, quote: span(i, i + 1), better_el: keepCase(t.w, ARTICLE_AFTER_SE[n.l]), why_ru: `Предлог «σε» сливается с артиклем: σε + ${n.l} → ${ARTICLE_AFTER_SE[n.l]}.` });
      continue;
    }
    // modal + verb without να
    if (MODALS.has(t.l) && !NOT_VERBS.has(n.l) && !MODALS.has(n.l) && VERB_END.test(n.l) && n.l.length >= 3 && known(n.l)) {
      add({ rule: 'modal_na', start: t.start, end: n.end, quote: span(i, i + 1), better_el: `${t.w} να ${n.w}`, why_ru: `После «${t.l}» второй глагол присоединяется через «να»: ${t.l} να ${n.l}.` });
      continue;
    }
    // personal pronoun + verb in the wrong person
    if (t.l === 'εγώ' && /ει$|εί$/u.test(n.l) && !NOT_VERBS.has(n.l)) {
      const to = n.l.endsWith('ει') ? `${n.l.slice(0, -2)}ω` : `${n.l.slice(0, -2)}ώ`;
      if (known(to)) add({ rule: 'pronoun_verb', start: t.start, end: n.end, quote: span(i, i + 1), better_el: `${t.w} ${to}`, why_ru: `С «εγώ» глагол стоит в 1-м лице: ${to}.` });
      continue;
    }
    if (t.l === 'εσύ' && /ω$|ώ$/u.test(n.l) && !NOT_VERBS.has(n.l)) {
      const to = n.l.endsWith('ω') ? `${n.l.slice(0, -1)}εις` : `${n.l.slice(0, -1)}είς`;
      if (known(to) && known(n.l)) add({ rule: 'pronoun_verb', start: t.start, end: n.end, quote: span(i, i + 1), better_el: `${t.w} ${to}`, why_ru: `С «εσύ» глагол стоит во 2-м лице: ${to}.` });
      continue;
    }
    // number > 1 + neuter singular (and the content noun right after it)
    if (NUMBERS.has(t.l) && isNeuterNoun(n.w)) {
      let last = i + 1;
      let better = `${t.w} ${keepCase(n.w, neuterPlural(n.l)!)}`;
      const m = toks[i + 2];
      if (m && /^\s+$/.test(text.slice(n.end, m.start)) && isNeuterNoun(m.w)) { last = i + 2; better += ` ${keepCase(m.w, neuterPlural(m.l)!)}`; }
      add({ rule: 'number_plural', start: t.start, end: toks[last].end, quote: span(i, last), better_el: better, why_ru: 'После числа больше одного существительное стоит во множественном числе.' });
      continue;
    }
    // (σ)το + [adjective] + masculine accusative noun → (σ)τον
    if (t.l === 'το' || t.l === 'στο') {
      const adj = isAdjOnO(n.w) && toks[i + 2] && /^\s+$/.test(text.slice(n.end, toks[i + 2].start)) ? i + 2 : null;
      const head = adj ?? i + 1;
      if (isMascNoun(toks[head].w) && (adj !== null || !isAdjOnO(n.w))) {
        const art = `${t.w}ν`;
        add({ rule: 'masc_article', start: t.start, end: toks[head].end, quote: span(i, head), better_el: [art, ...toks.slice(i + 1, head + 1).map((x) => x.w)].join(' '), why_ru: `Мужской род в винительном падеже: «${lower(art)}» — буква -ν у артикля мужского рода сохраняется.` });
      }
    }
  }
  // Numeral agreement (sync rule shared with the persona's guard).
  for (const f of fixNumeralAgreement(text).fixes) {
    const [quote, better] = f.split(' → ');
    const start = text.indexOf(quote);
    if (start < 0) continue;
    const to = lower(better.split(' ')[0]);
    const why_ru = to === 'έναν'
      ? 'Существительное мужского рода в винительном падеже: «έναν» (перед гласной и κ, π, τ буква -ν обязательна).'
      : to === 'ένα' ? '«ευρώ» — среднего рода: «ένα ευρώ».'
        : to === 'τρία' || to === 'τέσσερα' ? 'Числительное согласуется с родом: «τρία», «τέσσερα» — со словами среднего рода.'
          : 'Числительное согласуется с родом: «τρεις», «τέσσερις» — со словами мужского и женского рода.';
    add({ rule: 'numeral', start, end: start + quote.length, quote, better_el: better, why_ru });
  }
  return found.sort((a, b) => a.start - b.start);
}

/** The text with every finding applied (used to correct the persona's own reply before it is voiced). */
export async function applyCourseRules(text: string): Promise<{ text: string; fixes: string[] }> {
  const fs = await courseRuleFindings(text);
  let out = text.normalize('NFC');
  for (const f of [...fs].sort((a, b) => b.start - a.start)) out = out.slice(0, f.start) + f.better_el + out.slice(f.end);
  return { text: out, fixes: fs.map((f) => `${f.rule}: ${f.quote} → ${f.better_el}`) };
}
