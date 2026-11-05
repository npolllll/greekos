import type { ItemEnvelope, Verdict } from '../content/types.ts';
import { scoreDeterministic, scoreJointVector } from '../scoring/score.ts';
import type { ExamAnswer, ExamAnswers } from './core.ts';

export interface JointAdjudication {
  canonical_solution: string[];
  defensible_complete_alternative?: string[];
  additional_candidate_solutions?: Array<{ answers: string[]; decision: string }>;
}

export interface ExamItemResult {
  item_id: string;
  answered: boolean;
  verdict: Verdict;
  reliable: boolean;
  scorer: 'key' | 'structured' | 'joint_bank' | 'ai_assessor' | 'none';
  keyed: boolean;
  needs_ai: boolean;
  meaning_changing: boolean | null;
  error_kind: string | null;
  uncertainty: string | null;
  feedback_ru: string;
  evidence: Array<Record<string, unknown>>;
  response: ExamAnswer | null;
}

const KEYED = new Set(['CHOICE_KEY', 'EXACT_WITH_REVIEW_FALLBACK', 'STRUCTURED_WITH_REVIEW_FALLBACK']);

function gapOf(item: ItemEnvelope): number {
  const g = (item.stimulus as { gap?: unknown } | null)?.gap;
  return typeof g === 'number' ? g : Number(g ?? 0);
}

/**
 * Deterministic exam scoring. JOINT_BANK_REVIEW items are judged as one complete vector (U01 C1–C7)
 * — never per gap. Open responses are flagged needs_ai and left PENDING_REVIEW here.
 */
export function scoreExamDeterministic(items: ItemEnvelope[], answers: ExamAnswers, adjudication: JointAdjudication | null): ExamItemResult[] {
  const results: ExamItemResult[] = [];
  const joint = items.filter((i) => i.scoring.strategy === 'JOINT_BANK_REVIEW').sort((a, b) => gapOf(a) - gapOf(b));
  let jointVerdict: { verdict: Verdict; reliable: boolean; reason: string } | null = null;
  if (joint.length) {
    const vector = joint.map((i) => answers[i.item_id]?.text ?? '');
    jointVerdict = adjudication
      ? scoreJointVector(adjudication, vector)
      : { verdict: 'PENDING_REVIEW', reliable: false, reason: 'ADJUDICATION_MISSING_HOLD_FOR_REVIEW' };
  }

  for (const item of items) {
    const resp = answers[item.item_id] ?? null;
    const answered = !!resp && (resp.choice !== undefined || !!resp.text?.trim());
    const base: ExamItemResult = {
      item_id: item.item_id, answered, verdict: 'NOT_ASSESSED', reliable: false, scorer: 'none', keyed: KEYED.has(item.scoring.strategy),
      needs_ai: false, meaning_changing: null, error_kind: null, uncertainty: null, feedback_ru: '', evidence: [], response: resp,
    };
    if (item.scoring.strategy === 'JOINT_BANK_REVIEW') {
      const jv = jointVerdict!;
      results.push({
        ...base,
        verdict: jv.verdict,
        reliable: false,
        scorer: 'joint_bank',
        uncertainty: jv.reason,
        feedback_ru: jv.verdict === 'PENDING_REVIEW'
          ? 'Группа пропусков оценивается целиком; этот набор ответов направлен на проверку без штрафа.'
          : 'Группа пропусков совпала с задокументированным решением (предварительно, без окончательной калибровки).',
        evidence: [{ kind: 'joint_vector', reason: jv.reason, size: joint.length }],
      });
      continue;
    }
    if (!answered) {
      results.push({ ...base, uncertainty: 'NO_RESPONSE', feedback_ru: 'Нет ответа.' });
      continue;
    }
    try {
      const d = scoreDeterministic(item, resp!);
      results.push({
        ...base,
        verdict: d.verdict,
        reliable: d.reliable,
        scorer: d.scorer,
        needs_ai: d.needsReview && !!resp?.text && (item.type === 'open_response' || item.scoring.strategy === 'REVIEW_REQUIRED'),
        meaning_changing: d.meaningChanging,
        error_kind: d.errorKind,
        uncertainty: d.uncertainty,
        feedback_ru: d.feedbackRu,
        evidence: d.evidence,
      });
    } catch (e) {
      const code = (e as { code?: string }).code;
      results.push({ ...base, verdict: code === 'UNSUPPORTED_CONTENT_TYPE' ? 'UNSUPPORTED' : 'NOT_ASSESSED', uncertainty: code ?? 'INVALID_RESPONSE', feedback_ru: code === 'UNSUPPORTED_CONTENT_TYPE' ? 'Тип задания не поддерживается — оценка не выставляется.' : 'Ответ не удалось прочитать — не оценивается.' });
    }
  }
  return results;
}

export interface ExamSummary {
  total: number;
  answered: number;
  unanswered: number;
  keyed_total: number;
  keyed_correct_reliable: number;
  held_for_review: number;
  ai_assessed: number;
}

/** Raw counts only; no conversion to official points (no calibration exists). */
export function summarize(results: ExamItemResult[]): ExamSummary {
  const ok = (v: Verdict) => v === 'CORRECT' || v === 'ACCEPTABLE_VARIANT';
  return {
    total: results.length,
    answered: results.filter((r) => r.answered).length,
    unanswered: results.filter((r) => !r.answered && r.scorer !== 'joint_bank').length,
    keyed_total: results.filter((r) => r.keyed).length,
    keyed_correct_reliable: results.filter((r) => r.keyed && r.reliable && ok(r.verdict)).length,
    held_for_review: results.filter((r) => ['PENDING_REVIEW', 'ABSTAIN', 'AMBIGUOUS'].includes(r.verdict)).length,
    ai_assessed: results.filter((r) => r.scorer === 'ai_assessor').length,
  };
}
