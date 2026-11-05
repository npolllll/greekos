import { adapterFor, choiceOptions, type ItemEnvelope, type Verdict } from '../content/types.ts';
import { DEFAULT_STEPS, foldSigma, normalizeByPolicy, stripAccents, stripPunctuation, typographic } from './normalize.ts';

export interface LearnerResponse {
  /** For choice items: the stable option key. */
  choice?: string;
  /** Free text (short, structured or open). */
  text?: string;
}

export interface DeterministicScore {
  verdict: Verdict;
  scorer: 'key' | 'structured' | 'joint_bank' | 'none';
  /** Reliable evidence can change mastery; unreliable is stored but never moves mastery. */
  reliable: boolean;
  meaningChanging: boolean | null;
  errorKind: string | null;
  feedbackRu: string;
  /** Needs AI or human rubric review (no automatic penalty). */
  needsReview: boolean;
  matchedKey: string | null;
  evidence: Array<Record<string, unknown>>;
  uncertainty: string | null;
}

export class UnsupportedContentError extends Error {
  readonly code = 'UNSUPPORTED_CONTENT_TYPE';
  constructor(public itemId: string, public type: string) {
    super(`UNSUPPORTED_CONTENT_TYPE ${type} for ${itemId}`);
  }
}

export class InvalidResponseError extends Error {
  readonly code = 'INVALID_RESPONSE';
}

const MAX_TEXT = 6000;

function steps(item: ItemEnvelope): string[] {
  const n = item.scoring.policy?.normalization;
  return Array.isArray(n) ? (n as string[]) : DEFAULT_STEPS;
}

function keyStrings(values: unknown[]): string[] {
  return values.filter((v): v is string => typeof v === 'string');
}

function base(partial: Partial<DeterministicScore>): DeterministicScore {
  return {
    verdict: 'PENDING_REVIEW', scorer: 'none', reliable: false, meaningChanging: null, errorKind: null,
    feedbackRu: '', needsReview: false, matchedKey: null, evidence: [], uncertainty: null, ...partial,
  };
}

/** Compare a text answer with the item key under its own normalisation policy. */
export function compareText(item: ItemEnvelope, raw: string): DeterministicScore {
  const st = steps(item);
  const norm = (s: string) => normalizeByPolicy(s, st);
  const response = norm(raw);
  const keys = keyStrings(item.answer);
  const alts = keyStrings(item.accepted_alternatives);
  const all = [...keys, ...alts];

  const exact = all.find((k) => norm(k) === response);
  if (exact !== undefined) {
    return base({ verdict: 'CORRECT', scorer: 'key', reliable: true, meaningChanging: false, matchedKey: exact,
      feedbackRu: 'Верно.', evidence: [{ kind: 'key_match', key_source: keys.includes(exact) ? 'answer' : 'accepted_alternatives' }] });
  }
  const loose = (s: string) => stripPunctuation(typographic(norm(s)));
  const typo = all.find((k) => loose(k) === loose(raw));
  if (typo !== undefined) {
    return base({ verdict: 'ACCEPTABLE_VARIANT', scorer: 'key', reliable: true, meaningChanging: false, matchedKey: typo,
      errorKind: 'typography_only', feedbackRu: 'Верно по смыслу и форме; отличаются только знаки препинания или типографика.',
      evidence: [{ kind: 'typographic_equivalence' }] });
  }
  // Final-sigma form only (φίλοσ for φίλος, Νικος/Νίκοσ…): a confirmed orthographic error, not a new meaning.
  const sigmaOnly = all.find((k) => loose(k) !== loose(raw) && foldSigma(loose(k)) === foldSigma(loose(raw)));
  if (sigmaOnly !== undefined) {
    return base({ verdict: 'INCORRECT_CONFIRMED', scorer: 'key', reliable: true, meaningChanging: false, matchedKey: sigmaOnly,
      errorKind: 'final_sigma_orthography', feedbackRu: 'Буквы верные, но форма сигмы нет: в конце слова пишется ς, внутри слова — σ.',
      evidence: [{ kind: 'sigma_form_only_difference' }] });
  }
  const accentless = all.find((k) => stripAccents(loose(k)) === stripAccents(loose(raw)));
  if (accentless !== undefined) {
    return base({ verdict: 'INCORRECT_CONFIRMED', scorer: 'key', reliable: true, meaningChanging: false, matchedKey: accentless,
      errorKind: 'accent_orthography', feedbackRu: 'Слово выбрано верно, но ударение или диакритика отличаются. В греческом знак ударения обязателен.',
      evidence: [{ kind: 'accent_only_difference' }] });
  }
  return base({ verdict: 'PENDING_REVIEW', needsReview: true, uncertainty: 'UNLISTED_RESPONSE',
    feedbackRu: 'Такого варианта нет в ключе. Ответ отправлен на проверку — без штрафа.' });
}

/** Parse "1-Β, 2-Α" / "1Β 2Α" style assignments into a canonical sorted set. */
export function parsePairs(s: string, st: string[]): string[] | null {
  const norm = normalizeByPolicy(typographic(s), st);
  const parts = norm.split(/[,;\n]+/).map((p) => p.trim()).filter(Boolean);
  const pairs: string[] = [];
  for (const p of parts) {
    const m = p.match(/^(\p{N}+|\p{L})\s*(?:[-–:=→>]|\s)\s*(.+)$/u) ?? p.match(/^(\p{N}+)(\p{L}+)$/u);
    if (!m) return null;
    pairs.push(`${m[1]}:${m[2].trim()}`);
  }
  return pairs.length ? pairs.sort() : null;
}

/** Parse "Β, Α" / "Β Α" / "Β → Α" into an ordered sequence. */
export function parseSequence(s: string, st: string[]): string[] {
  return normalizeByPolicy(typographic(s), st).split(/\s*(?:,|→|->|-|\s)\s*/u).map((x) => x.trim()).filter(Boolean);
}

export function compareStructured(item: ItemEnvelope, raw: string): DeterministicScore {
  const st = steps(item);
  const all = [...keyStrings(item.answer), ...keyStrings(item.accepted_alternatives)];
  const isOrdering = item.type === 'ordering';
  const learner = isOrdering ? parseSequence(raw, st) : parsePairs(raw, st);
  if (!learner || !learner.length) {
    return base({ verdict: 'AMBIGUOUS', scorer: 'structured', needsReview: false, uncertainty: 'UNPARSEABLE_STRUCTURE',
      feedbackRu: isOrdering ? 'Не удалось прочитать порядок. Запишите буквы через запятую, например: Β, Α.' : 'Не удалось прочитать пары. Запишите так: 1-Α, 2-Β.' });
  }
  for (const k of all) {
    const key = isOrdering ? parseSequence(k, st) : parsePairs(k, st);
    if (key && key.length === learner.length && key.every((v, i) => v === learner[i])) {
      return base({ verdict: 'CORRECT', scorer: 'structured', reliable: true, meaningChanging: false, matchedKey: k,
        feedbackRu: 'Верно.', evidence: [{ kind: 'structured_vector_match', size: key.length }] });
    }
  }
  const key = isOrdering ? parseSequence(keyStrings(item.answer)[0] ?? '', st) : parsePairs(keyStrings(item.answer)[0] ?? '', st);
  if (key && key.length === learner.length && new Set(key).size === key.length) {
    const sameSet = [...key].sort().join('|') === [...learner].sort().join('|');
    // Complete vector over the same elements but a different arrangement is a confirmed error.
    if (isOrdering && sameSet) {
      return base({ verdict: 'INCORRECT_CONFIRMED', scorer: 'structured', reliable: true, meaningChanging: true,
        errorKind: 'wrong_order', feedbackRu: 'Порядок неверный. Проверьте последовательность событий.', evidence: [{ kind: 'structured_vector_mismatch' }] });
    }
    if (!isOrdering) {
      return base({ verdict: 'INCORRECT_CONFIRMED', scorer: 'structured', reliable: true, meaningChanging: true,
        errorKind: 'wrong_assignment', feedbackRu: 'Соответствия подобраны неверно.', evidence: [{ kind: 'structured_vector_mismatch' }] });
    }
  }
  return base({ verdict: 'PENDING_REVIEW', scorer: 'structured', needsReview: true, uncertainty: 'UNLISTED_VECTOR',
    feedbackRu: 'Ответ не совпал с ключом по форме. Отправлен на проверку без штрафа.' });
}

/**
 * Option keys that the item's answer designates. Exact label (or key) equality wins; the policy
 * normalisation is used only when it still points at exactly the same options. Returns null when
 * the key matches no option or a normalised match would be ambiguous (several options).
 */
export function keyedOptions(item: ItemEnvelope, opts: Array<{ key: string; label: string }>): Set<string> | null {
  const answers = keyStrings(item.answer).map((a) => a.normalize('NFC').trim());
  const exact = opts.filter((o) => answers.includes(o.label.normalize('NFC').trim()) || answers.includes(o.key));
  if (exact.length) return new Set(exact.map((o) => o.key));
  const st = steps(item);
  const keys = answers.map((k) => normalizeByPolicy(k, st));
  const loose = opts.filter((o) => keys.includes(normalizeByPolicy(o.label, st)));
  return loose.length === 1 ? new Set([loose[0].key]) : null;
}

/**
 * Deterministic part of scoring. Open responses and REVIEW_REQUIRED items return needsReview
 * so the AI assessor (validated JSON, may ABSTAIN) or a human can decide; no invented score.
 */
export function scoreDeterministic(item: ItemEnvelope, response: LearnerResponse): DeterministicScore {
  const kind = adapterFor(item.type, item.options);
  if (!kind) throw new UnsupportedContentError(item.item_id, item.type);
  if (item.scoring.strategy === 'JOINT_BANK_REVIEW') {
    return base({ verdict: 'PENDING_REVIEW', scorer: 'joint_bank', needsReview: true, uncertainty: 'JOINT_VECTOR_REQUIRED',
      feedbackRu: 'Это задание оценивается вместе со всей группой пропусков.' });
  }
  const reviewOnly = item.scoring.strategy === 'REVIEW_REQUIRED';

  if (kind === 'choice') {
    const opts = choiceOptions(item.options);
    const chosen = opts.find((o) => o.key === response.choice);
    if (!chosen) throw new InvalidResponseError('Выбранный вариант отсутствует в задании.');
    const correctKeys = keyedOptions(item, opts);
    if (!correctKeys) {
      // The key does not identify exactly one option (e.g. σ/ς after normalisation): never guess.
      return base({ verdict: 'AMBIGUOUS', scorer: 'key', reliable: false, uncertainty: 'AMBIGUOUS_CHOICE_KEY', feedbackRu: 'Ключ этого задания неоднозначен — ответ сохранён без оценки и передан на проверку.', evidence: [{ kind: 'choice_key_ambiguous', option_key: chosen.key }] });
    }
    const correct = correctKeys.has(chosen.key);
    const r = correct
      ? base({ verdict: 'CORRECT', scorer: 'key', reliable: true, meaningChanging: false, matchedKey: chosen.label, feedbackRu: 'Верно.', evidence: [{ kind: 'choice_key', option_key: chosen.key }] })
      : base({ verdict: 'INCORRECT_CONFIRMED', scorer: 'key', reliable: true, meaningChanging: true, errorKind: 'wrong_option', feedbackRu: 'Этот вариант не подходит.', evidence: [{ kind: 'choice_key', option_key: chosen.key }] });
    if (reviewOnly) {
      // Choice is keyed, but the item requires rubric review of the justification: provisional only.
      return { ...r, reliable: false, needsReview: (item.criteria?.length ?? 0) > 0, uncertainty: 'REVIEW_REQUIRED_STRATEGY' };
    }
    return r;
  }

  const text = (response.text ?? '').slice(0, MAX_TEXT + 1);
  if (!text.trim()) throw new InvalidResponseError('Пустой ответ не засчитывается.');
  if (text.length > MAX_TEXT) throw new InvalidResponseError('Ответ слишком длинный.');

  if (kind === 'open_text') {
    return base({ verdict: 'PENDING_REVIEW', needsReview: true, uncertainty: 'RUBRIC_REVIEW_REQUIRED',
      feedbackRu: 'Свободный ответ оценивается по критериям задания, а не сравнением с одним образцом.' });
  }
  const r = kind === 'structured_text' ? compareStructured(item, text) : compareText(item, text);
  if (reviewOnly) return { ...r, reliable: false, needsReview: r.verdict !== 'CORRECT' || (item.criteria?.length ?? 0) > 0, uncertainty: r.uncertainty ?? 'REVIEW_REQUIRED_STRATEGY' };
  return r;
}

/** U01 C1–C7: the complete vector is judged against U01_JOINT_ADJUDICATION; never per-gap penalties. */
export function scoreJointVector(adjudication: {
  canonical_solution: string[];
  defensible_complete_alternative?: string[];
  additional_candidate_solutions?: Array<{ answers: string[]; decision: string }>;
}, vector: string[]): { verdict: Verdict; reliable: boolean; reason: string } {
  const st = DEFAULT_STEPS;
  const n = (v: string[]) => v.map((x) => normalizeByPolicy(x ?? '', st)).join('|');
  const learner = n(vector);
  if (vector.some((v) => !v || !v.trim())) return { verdict: 'PENDING_REVIEW', reliable: false, reason: 'INCOMPLETE_VECTOR' };
  if (learner === n(adjudication.canonical_solution)) return { verdict: 'CORRECT', reliable: false, reason: 'CANONICAL_VECTOR_PROVISIONAL' };
  if (adjudication.defensible_complete_alternative && learner === n(adjudication.defensible_complete_alternative)) {
    return { verdict: 'ACCEPTABLE_VARIANT', reliable: false, reason: 'DOCUMENTED_ALTERNATIVE_PROVISIONAL' };
  }
  return { verdict: 'PENDING_REVIEW', reliable: false, reason: 'UNLISTED_VECTOR_HOLD_FOR_REVIEW' };
}
