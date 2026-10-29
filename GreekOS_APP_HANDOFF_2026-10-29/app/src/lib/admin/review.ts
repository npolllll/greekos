import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { adminClient } from '../supabase/admin.ts';
import { audit, HttpError, type SessionUser } from '../auth.ts';
import { taskKindFor } from '../content/types.ts';
import { scheduleLadder, resolveReview, type ReviewRow } from '../learning/reviews.ts';
import { refreshCompetencyState } from '../learning/state.ts';

export const OWNER_REVIEW_VERSION = 'owner-review/1';
const SPOKEN_TYPES = new Set(['spoken_interaction', 'D7_recall', 'D28_transfer']);
const NEGATIVE = ['independent_incorrect', 'review_failed', 'transfer_failed'];

export const ReviewDecision = z.object({
  assessment_id: z.string().uuid(),
  verdict: z.enum(['CORRECT', 'ACCEPTABLE_VARIANT', 'INCORRECT_CONFIRMED']),
  comment_ru: z.string().min(2).max(2000),
  correction_el: z.string().max(1000).optional(),
}).strict();

export const AppealDecision = z.object({
  appeal_id: z.string().uuid(),
  decision: z.enum(['UPHELD', 'REJECTED']),
  verdict: z.enum(['CORRECT', 'ACCEPTABLE_VARIANT']).optional(),
  note_ru: z.string().min(2).max(2000),
}).strict();

interface AttemptRow {
  attempt_id: string; user_id: string; item_id: string; context: string; assistance: string; preview: boolean;
  local_date: string; response_private: { source?: string } | null; content_hash: string;
}

async function loadContext(assessmentId: string) {
  const db = adminClient();
  const { data: a } = await db.from('assessments').select('*').eq('assessment_id', assessmentId).maybeSingle();
  if (!a) throw new HttpError(404, 'NOT_FOUND', 'Оценка не найдена');
  const { data: attempt } = await db.from('attempts').select('attempt_id, user_id, item_id, context, assistance, preview, local_date, response_private, content_hash').eq('attempt_id', a.attempt_id).maybeSingle();
  if (!attempt) throw new HttpError(404, 'NOT_FOUND', 'Попытка не найдена');
  const { data: item } = await db.from('items').select('item_id, item_type, section, competency_ids, current_hash, error_tags').eq('item_id', attempt.item_id).maybeSingle();
  const { data: profile } = await db.from('profiles').select('timezone').eq('user_id', attempt.user_id).maybeSingle();
  return { a, attempt: attempt as AttemptRow, item, tz: (profile?.timezone as string) ?? 'Europe/Athens' };
}

/** Evidence from an owner review counts only for independent, non-preview practice of non-spoken-typed tasks. */
function masteryEligible(attempt: AttemptRow, itemType: string): boolean {
  const spokenTyped = SPOKEN_TYPES.has(itemType) && (attempt.response_private?.source ?? 'typed') === 'typed';
  return attempt.assistance === 'none' && !attempt.preview && !['diagnostic', 'exam', 'preview'].includes(attempt.context) && !spokenTyped;
}

async function buildEvidence(attempt: AttemptRow, item: { item_type: string; section: string | null; competency_ids: string[]; current_hash: string; error_tags: string[] | null } | null, verdict: string, assessmentId: string, correction?: string) {
  const db = adminClient();
  const now = new Date().toISOString();
  const correct = verdict === 'CORRECT' || verdict === 'ACCEPTABLE_VARIANT';
  const comps = item?.competency_ids ?? [];
  const mastery: Array<Record<string, unknown>> = [];
  const completions: Array<Record<string, unknown>> = [];
  const ladders: Array<Record<string, unknown>> = [];
  const errors: Array<Record<string, unknown>> = [];
  if (!item || !masteryEligible(attempt, item.item_type)) return { mastery, completions, ladders, errors, eligible: false };
  const taskKind = attempt.context === 'transfer' ? 'transfer' : taskKindFor(item.item_type, item.section);
  const ev = (cid: string, type: string, extra: Record<string, unknown> = {}) => ({
    event_id: randomUUID(), user_id: attempt.user_id, competency_id: cid, attempt_id: attempt.attempt_id, item_id: attempt.item_id,
    event_type: type, task_kind: taskKind, reliable: true, meaning_changing: correct ? false : true, review_interval_days: null,
    supersedes_id: null, local_date: attempt.local_date, created_at: now, ...extra,
  });
  if (attempt.context === 'review' && comps.length) {
    const { data: due } = await db.from('spaced_reviews').select('id, competency_id, anchor_attempt_id, anchor_item_id, anchor_local_date, interval_days, due_local_date, status')
      .eq('user_id', attempt.user_id).eq('status', 'due').in('competency_id', comps).lte('due_local_date', attempt.local_date).order('due_local_date');
    for (const cid of comps) {
      const row = (due ?? []).find((r) => r.competency_id === cid) as ReviewRow | undefined;
      if (!row) continue;
      const outcome = resolveReview(row, { itemId: attempt.item_id, localDate: attempt.local_date, assisted: false, reliable: true, correct });
      if (outcome !== 'passed' && outcome !== 'failed') continue;
      completions.push({ id: row.id, status: outcome, completed_attempt_id: attempt.attempt_id, completed_local_date: attempt.local_date });
      mastery.push(ev(cid, outcome === 'passed' ? 'review_passed' : 'review_failed', { task_kind: 'retention', review_interval_days: row.interval_days }));
    }
  }
  for (const cid of comps) {
    if (attempt.context === 'transfer') mastery.push(ev(cid, correct ? 'transfer_passed' : 'transfer_failed'));
    else if (attempt.context !== 'review') mastery.push(ev(cid, correct ? 'independent_correct' : 'independent_incorrect'));
  }
  if (correct && ['recognition', 'controlled', 'spontaneous'].includes(taskKind) && attempt.context !== 'review' && comps.length) {
    const { data: active } = await db.from('spaced_reviews').select('competency_id').eq('user_id', attempt.user_id).eq('status', 'due').in('competency_id', comps);
    const activeSet = new Set((active ?? []).map((x) => x.competency_id));
    for (const cid of comps) ladders.push(...scheduleLadder({ userId: attempt.user_id, competencyId: cid, anchorAttemptId: attempt.attempt_id, anchorItemId: attempt.item_id, anchorLocalDate: attempt.local_date, contentHash: item.current_hash, hasActiveLadder: activeSet.has(cid), newId: randomUUID }));
  }
  if (!correct) {
    errors.push({
      id: randomUUID(), user_id: attempt.user_id, attempt_id: attempt.attempt_id, assessment_id: assessmentId, item_id: attempt.item_id,
      competency_id: comps[0] ?? null, verdict, error_kind: 'owner_review', error_tag: (item.error_tags ?? [])[0] ?? null, meaning_changing: true,
      evidence: { scorer: 'owner_review', note: 'Проверено владельцем — не независимый преподаватель' }, uncertainty: null,
      correction_el: correction ?? null, status: 'open', created_at: now,
    });
  }
  return { mastery, completions, ladders, errors, eligible: true };
}

function assessmentRow(base: { attempt_id: string; user_id: string }, verdict: string, supersedes: string, comment: string, prev: Record<string, unknown>) {
  return {
    assessment_id: randomUUID(), attempt_id: base.attempt_id, user_id: base.user_id, verdict, scorer: 'human', reliable: true,
    meaning_changing: verdict === 'INCORRECT_CONFIRMED', error_kind: verdict === 'INCORRECT_CONFIRMED' ? 'owner_review' : null,
    error_tags: prev.error_tags ?? null, rubric_id: prev.rubric_id ?? null, rubric_hash: prev.rubric_hash ?? null,
    assessor_version: OWNER_REVIEW_VERSION, dimensions: null,
    evidence: [{ kind: 'owner_review', label_ru: 'Проверено владельцем — не независимый преподаватель' }],
    uncertainty: null, feedback_ru: comment, status: 'ACTIVE', supersedes_id: supersedes, created_at: new Date().toISOString(),
  };
}

export async function decideReview(actor: SessionUser, d: z.infer<typeof ReviewDecision>) {
  const db = adminClient();
  const { a, attempt, item, tz } = await loadContext(d.assessment_id);
  if (a.status !== 'ACTIVE' || !['PENDING_REVIEW', 'ABSTAIN', 'AMBIGUOUS'].includes(a.verdict)) throw new HttpError(409, 'NOT_PENDING', 'Эта оценка уже не ожидает проверки');
  const next = assessmentRow(attempt, d.verdict, a.assessment_id, d.comment_ru, a);
  const ev = await buildEvidence(attempt, item, d.verdict, next.assessment_id, d.correction_el);
  const { data, error } = await db.rpc('commit_learning_event', {
    p: {
      user_id: attempt.user_id, idempotency_key: `owner-review-${a.assessment_id}`, scope: 'owner_review',
      assessment: next, mastery_events: ev.mastery, spaced_reviews_new: ev.ladders, spaced_review_completions: ev.completions,
      error_evidence: ev.errors,
      events: [{ event_type: 'exercise_submitted', idempotency_key: `owner-review-${a.assessment_id}`, payload: { item_id: attempt.item_id, verdict: d.verdict, reviewed_by: 'owner' } }, ...(ev.errors.length ? [{ event_type: 'mistake_detected', idempotency_key: `owner-review-${a.assessment_id}`, payload: { item_id: attempt.item_id } }] : [])],
      result: { assessment_id: next.assessment_id },
    },
  });
  if (error) throw new Error(error.message);
  if (!data?.replayed) await db.from('assessments').update({ status: 'SUPERSEDED' }).eq('assessment_id', a.assessment_id);
  if (ev.mastery.length) await refreshCompetencyState(attempt.user_id, [...new Set(ev.mastery.map((m) => m.competency_id as string))], tz);
  await audit(actor.userId, 'review.decided', { id: a.assessment_id, userId: attempt.user_id }, { verdict: d.verdict, mastery_events: ev.mastery.length, eligible: ev.eligible });
  return { ok: true, mastery_events: ev.mastery.length, mastery_eligible: ev.eligible };
}

export async function decideAppeal(actor: SessionUser, d: z.infer<typeof AppealDecision>) {
  const db = adminClient();
  const { data: appeal } = await db.from('appeals').select('id, user_id, assessment_id, status').eq('id', d.appeal_id).maybeSingle();
  if (!appeal) throw new HttpError(404, 'NOT_FOUND', 'Оспаривание не найдено');
  if (appeal.status !== 'OPEN') throw new HttpError(409, 'ALREADY_RESOLVED', 'Оспаривание уже рассмотрено');
  const { a, attempt, item, tz } = await loadContext(appeal.assessment_id);
  const now = new Date().toISOString();
  let comps: string[] = [];
  if (d.decision === 'UPHELD') {
    const verdict = d.verdict ?? 'CORRECT';
    const next = assessmentRow(attempt, verdict, a.assessment_id, d.note_ru, a);
    const { data: negatives } = await db.from('mastery_events').select('event_id, competency_id, event_type, task_kind').eq('attempt_id', attempt.attempt_id);
    const { data: alreadyComp } = await db.from('mastery_events').select('supersedes_id').eq('user_id', attempt.user_id).eq('event_type', 'compensation');
    const compensated = new Set((alreadyComp ?? []).map((c) => c.supersedes_id));
    const compensation = (negatives ?? []).filter((m) => NEGATIVE.includes(m.event_type) && !compensated.has(m.event_id)).map((m) => ({
      event_id: randomUUID(), user_id: attempt.user_id, competency_id: m.competency_id, attempt_id: attempt.attempt_id, item_id: attempt.item_id,
      event_type: 'compensation', task_kind: m.task_kind, reliable: true, meaning_changing: null, review_interval_days: null,
      supersedes_id: m.event_id, local_date: attempt.local_date, created_at: now,
    }));
    // Positive evidence only if the original attempt was eligible and had no positive event yet.
    const hadPositive = (negatives ?? []).some((m) => !NEGATIVE.includes(m.event_type) && m.event_type !== 'compensation' && m.event_type !== 'assisted_observation');
    const ev = hadPositive ? { mastery: [], completions: [], ladders: [], errors: [] } : await buildEvidence(attempt, item, verdict, next.assessment_id);
    const { error } = await db.rpc('commit_learning_event', {
      p: {
        user_id: attempt.user_id, idempotency_key: `appeal-resolve-${appeal.id}`, scope: 'appeal',
        assessment: next, mastery_events: [...compensation, ...ev.mastery.filter((m) => !NEGATIVE.includes(m.event_type as string))],
        spaced_reviews_new: ev.ladders,
        error_evidence_updates: [], events: [{ event_type: 'appeal_resolved', idempotency_key: `appeal-resolve-${appeal.id}`, payload: { decision: 'UPHELD', attempt_id: attempt.attempt_id } }],
        result: { ok: true },
      },
    });
    if (error) throw new Error(error.message);
    await db.from('assessments').update({ status: 'SUPERSEDED' }).eq('assessment_id', a.assessment_id);
    await db.from('error_evidence').update({ status: 'withdrawn' }).eq('assessment_id', a.assessment_id).eq('user_id', attempt.user_id);
    comps = [...new Set([...compensation, ...ev.mastery].map((m) => m.competency_id as string))];
  } else {
    await db.from('assessments').update({ status: 'ACTIVE' }).eq('assessment_id', a.assessment_id);
    await db.from('error_evidence').update({ status: 'open' }).eq('assessment_id', a.assessment_id).eq('user_id', attempt.user_id).eq('status', 'appealed');
    await db.from('learner_events').upsert({ user_id: attempt.user_id, event_type: 'appeal_resolved', idempotency_key: `appeal-resolve-${appeal.id}`, payload: { decision: 'REJECTED', attempt_id: attempt.attempt_id } }, { onConflict: 'user_id,event_type,idempotency_key', ignoreDuplicates: true });
    comps = item?.competency_ids ?? [];
  }
  await db.from('appeals').update({ status: d.decision, resolution_note: d.note_ru, resolved_by: actor.userId, resolved_at: now }).eq('id', appeal.id);
  if (comps.length) await refreshCompetencyState(attempt.user_id, comps, tz);
  await audit(actor.userId, 'appeal.resolved', { id: appeal.id, userId: attempt.user_id }, { decision: d.decision });
  return { ok: true };
}
