import { z } from 'zod';
import { env } from '../env.ts';
import { structuredCall, llmInfo } from '../providers/llm.ts';
import type { ItemEnvelope, Verdict } from '../content/types.ts';

export const ASSESSOR_VERSION = 'greekos-assessor/1.0';

const Evidence = z.object({
  quote: z.string().describe('EXACT substring copied from the learner response'),
  criterion_id: z.string(),
  observation_ru: z.string(),
});
const ErrorItem = z.object({
  quote: z.string().describe('EXACT substring of the learner response containing the error'),
  correction_el: z.string(),
  explanation_ru: z.string(),
  meaning_changing: z.boolean(),
});
export const AssessmentOutput = z.object({
  decision: z.enum(['ASSESSED', 'ABSTAIN']),
  verdict: z.enum(['CORRECT', 'ACCEPTABLE_VARIANT', 'INCORRECT_CONFIRMED', 'AMBIGUOUS']),
  confidence: z.enum(['high', 'medium', 'low']),
  task_completion: z.enum(['met', 'partial', 'not_met', 'unclear']),
  dimensions: z.array(z.object({ criterion_id: z.string(), label_ru: z.string(), level: z.enum(['met', 'partial', 'not_met', 'not_assessable']), note_ru: z.string() })),
  evidence: z.array(Evidence),
  errors: z.array(ErrorItem),
  feedback_ru: z.string(),
  improved_version_el: z.string().nullable(),
  abstain_reason: z.string().nullable(),
});
export type AssessmentOutput = z.infer<typeof AssessmentOutput>;

export interface Criterion { id: string; text: string }

/** Turns item criteria and rubric payloads into a flat, ID-addressable criterion list. */
export function criteriaFor(item: ItemEnvelope, rubricPayload: unknown): Criterion[] {
  const out: Criterion[] = [];
  (item.criteria ?? []).forEach((c, i) => typeof c === 'string' && out.push({ id: `C${i + 1}`, text: c }));
  const rub = (rubricPayload ?? (typeof item.rubric === 'object' ? item.rubric : null)) as Record<string, unknown> | null;
  if (rub && typeof rub === 'object') {
    const dims = (rub.dimensions ?? rub.criteria) as unknown;
    if (Array.isArray(dims)) {
      dims.forEach((d, i) => {
        const o = d as Record<string, unknown>;
        const id = String(o.id ?? o.dimension_id ?? o.criterion_id ?? `R${i + 1}`);
        out.push({ id, text: JSON.stringify(o).slice(0, 900) });
      });
    } else {
      for (const [k, v] of Object.entries(rub)) {
        if (['rubric_id', 'version', 'status', 'licensing', 'source_refs', 'qa'].includes(k)) continue;
        out.push({ id: k, text: (typeof v === 'string' ? v : JSON.stringify(v)).slice(0, 900) });
      }
    }
  }
  return out.length ? out : [{ id: 'TASK', text: 'Выполнение коммуникативной задачи, сформулированной в задании.' }];
}

export interface AiAssessment {
  verdict: Verdict;
  reliable: boolean;
  meaningChanging: boolean | null;
  confidence: 'high' | 'medium' | 'low' | null;
  dimensions: AssessmentOutput['dimensions'];
  evidence: Array<Record<string, unknown>>;
  feedbackRu: string;
  improvedEl: string | null;
  uncertainty: string | null;
  assessorVersion: string;
  errors: AssessmentOutput['errors'];
}

/**
 * Post-validation: quotes must literally occur in the learner text and criterion IDs must exist;
 * otherwise the assessment is discarded (ABSTAIN), never "repaired".
 */
export function validateAssessment(out: AssessmentOutput, learnerText: string, criteria: Criterion[]): { ok: true } | { ok: false; reason: string } {
  const text = learnerText.normalize('NFC');
  const ids = new Set(criteria.map((c) => c.id));
  for (const e of out.evidence) {
    if (!e.quote.trim() || !text.includes(e.quote.normalize('NFC'))) return { ok: false, reason: 'HALLUCINATED_EVIDENCE_SPAN' };
    if (!ids.has(e.criterion_id)) return { ok: false, reason: 'UNKNOWN_CRITERION' };
  }
  for (const e of out.errors) if (!e.quote.trim() || !text.includes(e.quote.normalize('NFC'))) return { ok: false, reason: 'HALLUCINATED_ERROR_SPAN' };
  for (const d of out.dimensions) if (!ids.has(d.criterion_id)) return { ok: false, reason: 'UNKNOWN_CRITERION' };
  if (out.decision === 'ASSESSED' && out.verdict === 'INCORRECT_CONFIRMED' && !out.errors.length && out.task_completion !== 'not_met') return { ok: false, reason: 'UNSUPPORTED_NEGATIVE_VERDICT' };
  if (out.decision === 'ASSESSED' && !out.evidence.length) return { ok: false, reason: 'NO_EVIDENCE' };
  return { ok: true };
}

const SYSTEM = `Ты — осторожный оценщик ответов изучающих новогреческий язык (интерфейс для ученика русский).
Правила, которые нельзя нарушать:
- Оценивай ТОЛЬКО фактический текст ученика по перечисленным критериям с их ID. Не сравнивай с образцом как с единственным ключом: образец — лишь одна возможная модель.
- Каждая цитата в evidence и errors должна быть ДОСЛОВНОЙ подстрокой ответа ученика (с теми же ударениями). Не исправляй цитату.
- Произношение, интонацию и беглость по тексту НЕ оценивай: такие критерии помечай not_assessable.
- Разговорные и регистрово допустимые варианты не считай ошибкой; отмечай стилистику отдельно в feedback.
- Если ответ неоднозначен, задание или ключ неясны, текст слишком короткий или ты не уверен — decision=ABSTAIN с причиной.
- INCORRECT_CONFIRMED только при явной ошибке, подтверждённой цитатой, или при невыполнении задачи.
- feedback_ru: 1–3 коротких приоритетных замечания по-русски, сначала смысл, потом форма. Не называй себя преподавателем и не выставляй официальных баллов.`;

export async function assessOpenResponse(params: {
  userId: string;
  item: ItemEnvelope;
  rubricPayload: unknown;
  learnerText: string;
  source: 'typed' | 'asr_confirmed';
}): Promise<AiAssessment> {
  const criteria = criteriaFor(params.item, params.rubricPayload);
  const abstain = (reason: string): AiAssessment => ({
    verdict: reason === 'NOT_CONFIGURED' ? 'PENDING_REVIEW' : 'ABSTAIN', reliable: false, meaningChanging: null, confidence: null,
    dimensions: [], evidence: [], errors: [], improvedEl: null, uncertainty: reason, assessorVersion: ASSESSOR_VERSION,
    feedbackRu: reason === 'NOT_CONFIGURED'
      ? 'Автоматическая проверка по критериям не подключена. Ответ сохранён и ждёт проверки — без штрафа.'
      : reason === 'LOCAL_MODEL_NOT_VALIDATED'
        ? 'Подключена только локальная модель, не проверенная для греческого: ответ не оценивается автоматически, сохранён и ждёт проверки — без штрафа.'
        : 'Автоматическая проверка воздержалась от оценки. Ответ сохранён для проверки — без штрафа.',
  });
  // An unvalidated local model would only produce an unreliable draft after a long wait on CPU: the
  // answer goes to review at once. LOCAL_LLM_ASSESS=1 enables the draft for model experiments.
  if (llmInfo().local && process.env.LOCAL_LLM_ASSESS !== '1') return { ...abstain('LOCAL_MODEL_NOT_VALIDATED'), verdict: 'PENDING_REVIEW' };
  const model = params.item.model_response;
  const user = [
    `Задание (${params.item.type}, уровень ${params.item.level ?? 'не указан'}):\n${params.item.prompt}`,
    `Критерии (ID: описание):\n${criteria.map((c) => `${c.id}: ${c.text}`).join('\n')}`,
    model ? `Одна возможная модель (НЕ исчерпывающий ключ):\n${typeof model === 'string' ? model : JSON.stringify(model)}` : '',
    (params.item.answer ?? []).length ? `Варианты из ключа (не исчерпывающие): ${JSON.stringify([...(params.item.answer ?? []), ...(params.item.accepted_alternatives ?? [])])}` : '',
    `Источник ответа: ${params.source === 'asr_confirmed' ? 'распознанная речь, подтверждённая учеником (произношение не оценивать)' : 'набранный текст'}`,
    `Ответ ученика:\n<<<\n${params.learnerText}\n>>>`,
  ].filter(Boolean).join('\n\n');

  const r = await structuredCall({
    userId: params.userId, operation: 'assess_open_response', model: env.llmModelAssessor,
    system: SYSTEM, user, schema: AssessmentOutput, effort: 'medium', maxTokens: 8000, timeoutMs: 60_000,
  });
  if (!r.ok) return abstain(r.reason);
  const out = r.data;
  if (out.decision === 'ABSTAIN') return { ...abstain('MODEL_ABSTAINED'), uncertainty: out.abstain_reason ?? 'MODEL_ABSTAINED', feedbackRu: out.feedback_ru || abstain('').feedbackRu };
  const v = validateAssessment(out, params.learnerText, criteria);
  if (!v.ok) return abstain(v.reason);
  // A local, unvalidated development model may give feedback but never moves mastery on its own.
  const unvalidatedEngine = llmInfo().local;
  const reliable = out.confidence === 'high' && out.verdict !== 'AMBIGUOUS' && !unvalidatedEngine;
  return {
    verdict: out.verdict,
    reliable,
    meaningChanging: out.errors.some((e) => e.meaning_changing) || out.task_completion === 'not_met',
    confidence: out.confidence,
    dimensions: out.dimensions,
    evidence: out.evidence.map((e) => ({ kind: 'ai_span', ...e })),
    errors: out.errors,
    feedbackRu: out.feedback_ru,
    improvedEl: out.improved_version_el,
    uncertainty: reliable ? null : unvalidatedEngine ? 'LOCAL_UNVALIDATED_MODEL' : `CONFIDENCE_${out.confidence.toUpperCase()}`,
    assessorVersion: `${ASSESSOR_VERSION}:${r.model}`,
  };
}
