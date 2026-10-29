import type { TaskKind } from '../content/types.ts';
import type { LocalDate } from './calendar.ts';

export type MasteryState =
  | 'unseen' | 'familiar' | 'recognition' | 'controlled' | 'spontaneous' | 'retention_due'
  | 'retained' | 'transfer_confirmed' | 'needs_review' | 'insufficient_evidence';

export type MasteryEventType =
  | 'independent_correct' | 'independent_incorrect' | 'assisted_observation' | 'review_passed'
  | 'review_failed' | 'transfer_passed' | 'transfer_failed' | 'compensation' | 'placement_observation';

export interface MasteryEventLite {
  event_id: string;
  event_type: MasteryEventType;
  task_kind: TaskKind | null;
  reliable: boolean;
  meaning_changing: boolean | null;
  item_id: string | null;
  review_interval_days: number | null;
  local_date: LocalDate;
  created_at: string;
  supersedes_id: string | null;
  /** True when the underlying assessment is under appeal: negative effect frozen. */
  frozen?: boolean;
}

export interface MasterySummary {
  recognition_items: number;
  controlled_items: number;
  spontaneous_items: number;
  d7_passed: boolean;
  d28_passed: boolean;
  transfer_passed: boolean;
  assisted_observations: number;
  reliable_errors: number;
  last_event_at: string | null;
  mastered: boolean;
}

const NEGATIVE: MasteryEventType[] = ['independent_incorrect', 'review_failed', 'transfer_failed'];
const POSITIVE: MasteryEventType[] = ['independent_correct', 'review_passed', 'transfer_passed'];

export function effectiveEvents(events: MasteryEventLite[]): MasteryEventLite[] {
  const superseded = new Set(events.filter((e) => e.event_type === 'compensation' && e.supersedes_id).map((e) => e.supersedes_id!));
  return events.filter((e) => !superseded.has(e.event_id) && e.event_type !== 'compensation' && !(e.frozen && NEGATIVE.includes(e.event_type)));
}

/**
 * Derive one competency's state from its event log. Defaults (2 distinct items per stage) are
 * project defaults from ADAPTIVE_ENGINE_CONTRACT, not validated thresholds.
 */
export function deriveCompetencyState(all: MasteryEventLite[], hasDueReview: boolean): { state: MasteryState; summary: MasterySummary } {
  const events = effectiveEvents(all).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const reliable = events.filter((e) => e.reliable);
  const distinct = (kind: TaskKind) => new Set(reliable.filter((e) => e.event_type === 'independent_correct' && e.task_kind === kind).map((e) => e.item_id)).size;
  const passed = (interval: number) => reliable.some((e) => e.event_type === 'review_passed' && e.review_interval_days === interval);

  const summary: MasterySummary = {
    recognition_items: distinct('recognition'),
    controlled_items: distinct('controlled'),
    spontaneous_items: distinct('spontaneous'),
    d7_passed: passed(7),
    d28_passed: passed(28),
    transfer_passed: reliable.some((e) => e.event_type === 'transfer_passed'),
    assisted_observations: events.filter((e) => e.event_type === 'assisted_observation').length,
    reliable_errors: reliable.filter((e) => NEGATIVE.includes(e.event_type) && e.meaning_changing !== false).length,
    last_event_at: events.at(-1)?.created_at ?? null,
    mastered: false,
  };

  if (!events.length) return { state: 'unseen', summary };
  if (!reliable.length) return { state: summary.assisted_observations ? 'familiar' : 'insufficient_evidence', summary };

  const lastNeg = [...reliable].reverse().find((e) => NEGATIVE.includes(e.event_type) && e.meaning_changing !== false);
  const lastPos = [...reliable].reverse().find((e) => POSITIVE.includes(e.event_type));
  const retained = summary.d7_passed && summary.d28_passed;
  summary.mastered = retained;

  if (lastNeg && (!lastPos || lastNeg.created_at > lastPos.created_at)) return { state: 'needs_review', summary };
  if (retained && summary.transfer_passed) return { state: 'transfer_confirmed', summary };
  if (retained) return { state: 'retained', summary };
  const stage: MasteryState | null = summary.spontaneous_items >= 2 ? 'spontaneous'
    : summary.controlled_items >= 2 ? 'controlled'
    : summary.recognition_items >= 2 ? 'recognition' : null;
  if (stage && hasDueReview) return { state: 'retention_due', summary };
  if (stage) return { state: stage, summary };
  return { state: 'familiar', summary };
}

export const MASTERY_LABEL_RU: Record<MasteryState, string> = {
  unseen: 'Ещё не начато',
  familiar: 'Знакомо',
  recognition: 'Узнаёт',
  controlled: 'Применяет по образцу',
  spontaneous: 'Применяет самостоятельно',
  retention_due: 'Ждёт отсроченной проверки',
  retained: 'Сохранено (D7 и D28)',
  transfer_confirmed: 'Перенос подтверждён',
  needs_review: 'Нужно повторить',
  insufficient_evidence: 'Недостаточно данных',
};

/** Negative mastery update allowed only for confirmed, non-technical, unassisted evidence. */
export function negativeUpdateAllowed(input: { confirmed: boolean; technicalFailure: boolean; assisted: boolean; asrUncertain?: boolean; appealPending?: boolean }): boolean {
  return input.confirmed && !input.technicalFailure && !input.assisted && !input.asrUncertain && !input.appealPending;
}

/** Retention requires separate unassisted D7 and D28 successes. */
export function isRetained(input: { D7: boolean; D28: boolean; assisted: boolean }): boolean {
  return input.D7 && input.D28 && !input.assisted;
}
