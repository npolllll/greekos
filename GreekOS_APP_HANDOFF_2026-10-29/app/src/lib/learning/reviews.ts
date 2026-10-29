import { addDays, type LocalDate } from './calendar.ts';

export const REVIEW_INTERVALS = [1, 3, 7, 14, 28] as const;
export type ReviewInterval = (typeof REVIEW_INTERVALS)[number];

export interface ReviewRow {
  id: string;
  competency_id: string;
  anchor_attempt_id: string;
  anchor_item_id: string;
  anchor_local_date: LocalDate;
  interval_days: ReviewInterval;
  due_local_date: LocalDate;
  status: 'due' | 'passed' | 'failed' | 'assisted' | 'superseded';
}

/**
 * Schedule the D1…D28 ladder from the learner-local date of a qualifying independent attempt
 * (never from login). Only one active ladder per competency.
 */
export function scheduleLadder(params: {
  userId: string;
  competencyId: string;
  anchorAttemptId: string;
  anchorItemId: string;
  anchorLocalDate: LocalDate;
  contentHash: string;
  hasActiveLadder: boolean;
  newId: () => string;
}) {
  if (params.hasActiveLadder) return [];
  return REVIEW_INTERVALS.map((interval) => ({
    id: params.newId(),
    user_id: params.userId,
    competency_id: params.competencyId,
    anchor_attempt_id: params.anchorAttemptId,
    anchor_item_id: params.anchorItemId,
    anchor_local_date: params.anchorLocalDate,
    interval_days: interval,
    due_local_date: addDays(params.anchorLocalDate, interval),
    status: 'due' as const,
    completed_attempt_id: null,
    completed_local_date: null,
    content_hash: params.contentHash,
    created_at: new Date().toISOString(),
  }));
}

export type ReviewOutcome = 'passed' | 'failed' | 'assisted' | 'no_change';

/**
 * Resolve a review probe. A probe counts only on/after its due date, on a different item than
 * the anchor (fresh context), and only with reliable evidence; uncertainty leaves it due.
 */
export function resolveReview(review: ReviewRow, attempt: {
  itemId: string;
  localDate: LocalDate;
  assisted: boolean;
  reliable: boolean;
  correct: boolean;
}): ReviewOutcome {
  if (review.status !== 'due') return 'no_change';
  if (attempt.localDate < review.due_local_date) return 'no_change';
  if (attempt.itemId === review.anchor_item_id) return 'no_change';
  if (attempt.assisted) return 'assisted';
  if (!attempt.reliable) return 'no_change';
  return attempt.correct ? 'passed' : 'failed';
}

export function dueReviews<T extends { status: string; due_local_date: string }>(rows: T[], today: LocalDate): T[] {
  return rows.filter((r) => r.status === 'due' && r.due_local_date <= today).sort((a, b) => a.due_local_date.localeCompare(b.due_local_date));
}
