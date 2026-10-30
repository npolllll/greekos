import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { adminClient } from '../supabase/admin.ts';
import { HttpError, type SessionUser } from '../auth.ts';
import { loadItem, releaseMap, playableAudio, itemAccess, type ItemRow } from '../content/repo.ts';
import { scoreDeterministic, type DeterministicScore } from '../scoring/score.ts';
import { assessOpenResponse, type AiAssessment } from '../ai/assessor.ts';
import { llmConfigured } from '../providers/llm.ts';
import { taskKindFor, adapterFor, type Verdict } from '../content/types.ts';
import { localDateOf } from './calendar.ts';
import { scheduleLadder, resolveReview, type ReviewRow } from './reviews.ts';
import { refreshCompetencyState } from './state.ts';

export const AttemptRequest = z.object({
  item_id: z.string().min(1).max(80),
  content_hash: z.string().regex(/^[0-9a-f]{64}$/),
  response: z.object({ choice: z.string().max(40).optional(), text: z.string().max(6000).optional() }).strict(),
  assistance: z.enum(['none', 'hint', 'model_shown', 'retry_after_model', 'translation', 'tutor_help']).default('none'),
  context: z.enum(['lesson', 'review', 'diagnostic', 'transfer', 'preview', 'pegp', 'real_greek', 'writing', 'corrective', 'speaking']),
  context_ref: z.string().max(80).optional(),
  feedback_event_id: z.string().uuid().optional(),
  response_source: z.enum(['typed', 'asr_confirmed']).default('typed'),
  active_ms: z.number().int().min(0).max(3_600_000).optional(),
  idempotency_key: z.string().min(8).max(200),
}).strict();
export type AttemptRequest = z.infer<typeof AttemptRequest>;

export interface AttemptResult {
  attempt_id: string;
  verdict: Verdict;
  reliable: boolean;
  scorer: string;
  feedback_ru: string;
  error_kind: string | null;
  ai: { used: boolean; confidence: string | null; dimensions: unknown[]; improved_el: string | null; errors: unknown[] } | null;
  reveal: { key: string[]; model_response: string | null } | null;
  /** Author's rationale from the canonical item (shown after answering, never in diagnostics/exams). */
  explanation_ru: string | null;
  feedback_event_id: string | null;
  review: { outcome: string; interval_days: number } | null;
  scheduled_reviews: string[];
  mastery_counted: boolean;
  preview: boolean;
  replayed?: boolean;
}

const NO_MASTERY_CONTEXTS = new Set(['preview', 'diagnostic']);
const SPOKEN_TYPES = new Set(['spoken_interaction', 'D7_recall', 'D28_transfer']);

async function rubricPayload(item: ItemRow): Promise<unknown> {
  const r = item.envelope.rubric;
  if (typeof r === 'string') {
    const { data } = await adminClient().from('rubrics').select('payload').eq('rubric_id', r).maybeSingle();
    return data?.payload ?? null;
  }
  return r ?? null;
}

export async function submitAttempt(user: SessionUser, req: AttemptRequest): Promise<AttemptResult> {
  const db = adminClient();
  const replay = await db.from('idempotency_keys').select('result').eq('user_id', user.userId).eq('key', req.idempotency_key).maybeSingle();
  if (replay.data?.result) return { ...(replay.data.result as AttemptResult), replayed: true };

  const item = await loadItem(req.item_id);
  if (!item) throw new HttpError(404, 'NOT_FOUND', 'Задание не найдено');
  if (req.content_hash !== item.current_hash) throw new HttpError(409, 'CONTENT_CHANGED', 'Задание обновилось. Обновите страницу.');
  if (!adapterFor(item.item_type, item.envelope.options)) throw Object.assign(new Error('unsupported'), { code: 'UNSUPPORTED_CONTENT_TYPE' });

  const preview = req.context === 'preview';
  if (preview && !user.isOwner) throw new HttpError(403, 'FORBIDDEN', 'Предпросмотр доступен только владельцу');
  // DEV-PREVIEW accounts may answer gated items; the attempt records released_snapshot=false.
  const [releases, audio] = await Promise.all([
    releaseMap('item', [{ id: item.item_id, hash: item.current_hash }], user),
    playableAudio(item.audio_job_ids, user),
  ]);
  const access = itemAccess(item, releases, audio);
  if (!preview && !access.learnerUsable) throw new HttpError(403, access.reason, access.reason === 'AUDIO_PENDING' ? 'Аудио пока недоступно — задание не оценивается.' : 'Материал проходит проверку и пока закрыт.');
  if (!preview && item.pool === 'diagnostic_holdout' && req.context !== 'diagnostic') throw new HttpError(403, 'HOLDOUT', 'Диагностическое задание не используется для тренировки.');
  if (!preview && item.module === 'keg_b2') throw new HttpError(403, 'EXAM_ONLY', 'Экзаменационные задания проходят только в экзаменационной попытке.');

  // 1. Deterministic scoring, then (if needed) bounded AI rubric assessment.
  const det: DeterministicScore = scoreDeterministic(item.envelope, req.response);
  let ai: AiAssessment | null = null;
  if (det.needsReview && req.response.text && llmConfigured()) {
    ai = await assessOpenResponse({ userId: user.userId, item: item.envelope, rubricPayload: await rubricPayload(item), learnerText: req.response.text, source: req.response_source });
  }
  let verdict: Verdict = ai && !['ABSTAIN', 'PENDING_REVIEW'].includes(ai.verdict) ? ai.verdict : det.verdict;
  let reliable = ai && !['ABSTAIN', 'PENDING_REVIEW'].includes(ai.verdict) ? ai.reliable : det.reliable;
  if (ai && ['ABSTAIN', 'PENDING_REVIEW'].includes(ai.verdict)) { verdict = det.verdict === 'CORRECT' ? det.verdict : 'PENDING_REVIEW'; reliable = false; }
  const meaningChanging = ai && reliable ? ai.meaningChanging : det.meaningChanging;
  const assisted = req.assistance !== 'none';
  const correct = verdict === 'CORRECT' || verdict === 'ACCEPTABLE_VARIANT';
  // A typed answer to a spoken task is a written fallback: stored and assessed, never spoken mastery.
  const learnerSpeechTask = SPOKEN_TYPES.has(item.item_type) || (item.requires_audio && item.audio_job_ids.length === 0);
  const spokenTyped = learnerSpeechTask && req.response_source === 'typed';
  const masteryCounted = !preview && !spokenTyped && !NO_MASTERY_CONTEXTS.has(req.context) && reliable && !assisted && (correct || verdict === 'INCORRECT_CONFIRMED');

  const now = new Date();
  const localDate = localDateOf(now, user.profile.timezone);
  const attemptId = randomUUID();
  const assessmentId = randomUUID();
  const taskKind = req.context === 'transfer' ? 'transfer' : taskKindFor(item.item_type, item.section);
  const competencies = item.competency_ids;

  // 2. Delayed reviews resolved by this attempt (local date, different item, unassisted, reliable).
  let reviewOutcome: AttemptResult['review'] = null;
  const completions: Array<Record<string, unknown>> = [];
  const masteryEvents: Array<Record<string, unknown>> = [];
  const baseEvent = (cid: string, type: string, extra: Record<string, unknown> = {}) => ({
    event_id: randomUUID(), user_id: user.userId, competency_id: cid, attempt_id: attemptId, item_id: item.item_id,
    event_type: type, task_kind: taskKind, reliable, meaning_changing: meaningChanging, review_interval_days: null,
    supersedes_id: null, local_date: localDate, created_at: now.toISOString(), ...extra,
  });
  if (!preview && competencies.length) {
    const { data: dueRows } = await db.from('spaced_reviews').select('id, competency_id, anchor_attempt_id, anchor_item_id, anchor_local_date, interval_days, due_local_date, status').eq('user_id', user.userId).eq('status', 'due').in('competency_id', competencies).lte('due_local_date', localDate).order('due_local_date');
    for (const cid of competencies) {
      const row = (dueRows ?? []).find((r) => r.competency_id === cid) as ReviewRow | undefined;
      if (!row) continue;
      const outcome = resolveReview(row, { itemId: item.item_id, localDate, assisted, reliable, correct });
      if (outcome === 'no_change') continue;
      completions.push({ id: row.id, status: outcome, completed_attempt_id: attemptId, completed_local_date: localDate });
      if (outcome !== 'assisted') masteryEvents.push(baseEvent(cid, outcome === 'passed' ? 'review_passed' : 'review_failed', { task_kind: 'retention', review_interval_days: row.interval_days }));
      reviewOutcome ??= { outcome, interval_days: row.interval_days };
    }
  }

  // 3. Mastery evidence (never from preview/diagnostic/assisted/unreliable).
  if (!preview && !spokenTyped && req.context !== 'diagnostic') {
    for (const cid of competencies) {
      if (assisted) { masteryEvents.push(baseEvent(cid, 'assisted_observation', { reliable: false })); continue; }
      if (!reliable) continue;
      if (req.context === 'transfer') masteryEvents.push(baseEvent(cid, correct ? 'transfer_passed' : 'transfer_failed'));
      else if (correct) masteryEvents.push(baseEvent(cid, 'independent_correct'));
      else if (verdict === 'INCORRECT_CONFIRMED') masteryEvents.push(baseEvent(cid, 'independent_incorrect'));
    }
  }

  // 4. D1…D28 ladder from the local date of a qualifying independent attempt.
  const newReviews: Array<Record<string, unknown>> = [];
  if (masteryCounted && correct && ['recognition', 'controlled', 'spontaneous'].includes(taskKind) && ['lesson', 'corrective', 'writing', 'speaking', 'pegp', 'real_greek'].includes(req.context)) {
    const { data: active } = await db.from('spaced_reviews').select('competency_id').eq('user_id', user.userId).eq('status', 'due').in('competency_id', competencies);
    const activeSet = new Set((active ?? []).map((a) => a.competency_id));
    for (const cid of competencies) {
      newReviews.push(...scheduleLadder({ userId: user.userId, competencyId: cid, anchorAttemptId: attemptId, anchorItemId: item.item_id, anchorLocalDate: localDate, contentHash: item.current_hash, hasActiveLadder: activeSet.has(cid), newId: randomUUID }));
    }
  }

  // 5. Error Notebook evidence + contextual feedback event (v5.2) for confirmed errors only.
  const errorRows: Array<Record<string, unknown>> = [];
  let feedbackEvent: Record<string, unknown> | null = null;
  if (!preview && reliable && !assisted && verdict === 'INCORRECT_CONFIRMED') {
    const validTag = (item.error_tags ?? [])[0] ?? null;
    errorRows.push({
      id: randomUUID(), user_id: user.userId, attempt_id: attemptId, assessment_id: assessmentId, item_id: item.item_id,
      competency_id: competencies[0] ?? null, verdict, error_kind: det.errorKind ?? (ai ? 'rubric_error' : null), error_tag: validTag,
      meaning_changing: meaningChanging, evidence: { scorer: ai?.reliable ? 'ai_assessor' : det.scorer, spans: ai?.errors ?? det.evidence, prompt: item.envelope.prompt },
      uncertainty: ai?.uncertainty ?? det.uncertainty, correction_el: ai?.errors?.[0]?.correction_el ?? (det.matchedKey ?? null),
      status: 'open', created_at: now.toISOString(),
    });
    feedbackEvent = {
      id: randomUUID(), user_id: user.userId, attempt_id: attemptId, competency_id: competencies[0] ?? null,
      error_code: validTag ?? det.errorKind ?? 'UNRESOLVED', verdict, explanation_version: 'context-v1', example_refs: [], captured_at: now.toISOString(),
    };
  }

  const transferAttempt = req.context === 'transfer' && req.feedback_event_id && !preview
    ? { id: randomUUID(), user_id: user.userId, feedback_event_id: req.feedback_event_id, attempt_id: attemptId, verdict, evaluated_at: now.toISOString() }
    : null;

  const reveal = req.context === 'diagnostic' ? null : {
    key: [...(item.envelope.answer ?? []), ...(item.envelope.accepted_alternatives ?? [])].filter((x): x is string => typeof x === 'string').slice(0, 6),
    model_response: typeof item.envelope.model_response === 'string' ? item.envelope.model_response : null,
  };

  const result: AttemptResult = {
    attempt_id: attemptId, verdict, reliable, scorer: ai && ai.verdict !== 'ABSTAIN' && ai.verdict !== 'PENDING_REVIEW' ? 'ai_assessor' : det.scorer,
    feedback_ru: `${ai ? ai.feedbackRu : det.feedbackRu}${spokenTyped ? ' Устное задание выполнено письменно: это сохраняется как письменная практика и не засчитывается как говорение.' : ''}`, error_kind: det.errorKind,
    ai: ai ? { used: true, confidence: ai.confidence, dimensions: ai.dimensions, improved_el: ai.improvedEl, errors: ai.errors } : null,
    reveal, explanation_ru: req.context === 'diagnostic' ? null : typeof item.envelope.original_payload?.rationale === 'string' ? (item.envelope.original_payload.rationale as string) : null,
    feedback_event_id: (feedbackEvent?.id as string) ?? null, review: reviewOutcome,
    scheduled_reviews: newReviews.filter((r) => [7, 28].includes(r.interval_days as number)).map((r) => `D${r.interval_days}: ${r.due_local_date}`),
    mastery_counted: masteryCounted, preview,
  };

  const events: Array<Record<string, unknown>> = [{ event_type: 'exercise_submitted', idempotency_key: req.idempotency_key, source_version: item.current_hash.slice(0, 12), payload: { item_id: item.item_id, verdict, context: req.context, preview } }];
  if (errorRows.length) events.push({ event_type: 'mistake_detected', idempotency_key: req.idempotency_key, payload: { item_id: item.item_id, competency_id: competencies[0] ?? null } });
  if (reviewOutcome?.outcome === 'passed') events.push({ event_type: 'delayed_review_passed', idempotency_key: req.idempotency_key, payload: { interval_days: reviewOutcome.interval_days } });
  if (reviewOutcome?.outcome === 'failed') events.push({ event_type: 'delayed_review_failed', idempotency_key: req.idempotency_key, payload: { interval_days: reviewOutcome.interval_days } });
  if (transferAttempt && correct && reliable) events.push({ event_type: 'context_transfer_passed', idempotency_key: req.idempotency_key, payload: { item_id: item.item_id } });

  const bundle = {
    user_id: user.userId,
    idempotency_key: req.idempotency_key,
    scope: 'attempt',
    attempt: {
      attempt_id: attemptId, user_id: user.userId, item_id: item.item_id, content_hash: item.current_hash, context: req.context,
      context_ref: req.context_ref ?? null, response_private: { ...req.response, source: req.response_source }, assistance: req.assistance,
      released_snapshot: access.learnerUsable && !access.devPreview, preview, idempotency_key: req.idempotency_key, local_date: localDate,
      timezone: user.profile.timezone, active_ms: req.active_ms ?? null, created_at: now.toISOString(),
    },
    assessment: {
      assessment_id: assessmentId, attempt_id: attemptId, user_id: user.userId, verdict, scorer: result.scorer, reliable,
      meaning_changing: meaningChanging, error_kind: det.errorKind, error_tags: item.error_tags, rubric_id: typeof item.envelope.rubric === 'string' ? item.envelope.rubric : null,
      rubric_hash: null, assessor_version: ai?.assessorVersion ?? 'deterministic-key/1.0', dimensions: ai?.dimensions ?? null,
      evidence: ai?.evidence?.length ? ai.evidence : det.evidence, uncertainty: ai?.uncertainty ?? det.uncertainty, feedback_ru: result.feedback_ru,
      status: 'ACTIVE', supersedes_id: null, created_at: now.toISOString(),
    },
    mastery_events: masteryEvents,
    spaced_reviews_new: newReviews,
    spaced_review_completions: completions,
    error_evidence: errorRows,
    feedback_event: feedbackEvent,
    transfer_attempt: transferAttempt,
    activity: preview ? null : { local_date: localDate, attempts: 1, active_seconds: Math.min(1800, Math.round((req.active_ms ?? 0) / 1000)) },
    events,
    result,
  };
  const { data, error } = await db.rpc('commit_learning_event', { p: bundle });
  if (error) throw new Error(`commit failed: ${error.message}`);
  if (data?.replayed) return { ...(data.result as AttemptResult), replayed: true };

  if (masteryEvents.length) {
    const changed = await refreshCompetencyState(user.userId, [...new Set(masteryEvents.map((m) => m.competency_id as string))], user.profile.timezone);
    if (changed.some((c) => c.changed)) {
      await db.from('learner_events').insert({ user_id: user.userId, event_type: 'competency_mastery_updated', idempotency_key: req.idempotency_key, payload: { competencies: changed.filter((c) => c.changed) } });
    }
  }
  return result;
}
