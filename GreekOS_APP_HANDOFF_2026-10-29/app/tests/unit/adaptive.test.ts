import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { splitBudget, redistribute, prerequisiteOutdegree, orderItems, itemEligibility, publicationAllowed, knownMinutes, rankWeak, correctiveSlotKind } from '@/lib/learning/planner';
import { planEndDate, inUtcWindow, addMonthsClamped, localDateOf, addDays } from '@/lib/learning/calendar';
import { deriveCompetencyState, isRetained, negativeUpdateAllowed, type MasteryEventLite } from '@/lib/learning/mastery';
import { resolveReview, scheduleLadder } from '@/lib/learning/reviews';

const corpus = resolve(process.env.CORPUS_ROOT ?? '../spec/GreekOS_CLAUDE_UPLOAD_READY');
const adaptive = JSON.parse(readFileSync(resolve(corpus, 'SPEC/ADAPTIVE_FIXTURES.json'), 'utf8'));
const finalization = JSON.parse(readFileSync(resolve(corpus, 'SPEC/FINALIZATION_ACCEPTANCE_FIXTURES.json'), 'utf8'));
const fx = (id: string) => adaptive.fixtures.find((f: { id: string }) => f.id === id);

let n = 0;
const ev = (p: Partial<MasteryEventLite>): MasteryEventLite => ({
  event_id: `e${++n}`, event_type: 'independent_correct', task_kind: 'controlled', reliable: true, meaning_changing: false,
  item_id: 'I1', review_interval_days: null, local_date: '2026-10-01', created_at: `2026-10-01T00:00:${String(n).padStart(2, '0')}Z`,
  supersedes_id: null, ...p,
});

describe('ADAPTIVE_FIXTURES (SPEC/ADAPTIVE_FIXTURES.json)', () => {
  it('AD01/AD02 budget split with largest remainder and 80/20 correction', () => {
    for (const id of ['AD01', 'AD02']) {
      const f = fx(id);
      expect(splitBudget(f.input.available_minutes)).toEqual({
        correction: f.expected.correction, retention: f.expected.retention, new_content: f.expected.new_content,
        independent_application: f.expected.independent_application, weak_correction: f.expected.weak_correction,
        strong_correction: f.expected.strong_correction,
      });
    }
  });

  it('AD03 ASR uncertainty never produces a negative update', () => {
    expect(negativeUpdateAllowed({ confirmed: false, technicalFailure: false, assisted: false, asrUncertain: true })).toBe(false);
  });

  it('AD04 correct but hinted production does not advance independent state', () => {
    const r = deriveCompetencyState([ev({ event_type: 'assisted_observation', reliable: false, task_kind: 'spontaneous' })], false);
    expect(r.state).toBe('familiar');
  });

  it('AD05 listening item without audio is ineligible', () => {
    expect(itemEligibility({ released: true, requiresAudio: true, audioVerified: false, pool: null, mode: 'tutoring', usedInSession: false, prerequisitesKnownUnmet: false }))
      .toEqual({ eligible: false, reason: 'AUDIO_UNAVAILABLE' });
  });

  it('AD06/HOLDOUT-01 exam holdout excluded from tutoring', () => {
    expect(itemEligibility({ released: true, requiresAudio: false, audioVerified: false, pool: 'exam_holdout', mode: 'tutoring', usedInSession: false, prerequisitesKnownUnmet: false }).eligible).toBe(false);
  });

  it('AD07 unknown prerequisite evidence assigns a probe, not a skip', () => {
    expect(itemEligibility({ released: true, requiresAudio: false, audioVerified: false, pool: null, mode: 'tutoring', usedInSession: false, prerequisitesKnownUnmet: true }))
      .toEqual({ eligible: false, reason: 'PREREQUISITE_PROBE_REQUIRED' });
  });

  it('AD08 repeating the same item never confirms transfer', () => {
    const events = Array.from({ length: 10 }, () => ev({ item_id: 'SAME' }));
    const r = deriveCompetencyState(events, false);
    expect(r.state).not.toBe('transfer_confirmed');
    expect(r.summary.controlled_items).toBe(1);
  });

  it('AD10 empty correction buckets move to retention', () => {
    const r = redistribute(splitBudget(100), { weak: false, strong: false, retention: true, new_content: true, independent_application: true });
    expect(r.log[0]).toMatchObject({ from: 'correction', to: 'retention' });
    expect(r.budget.retention).toBe(50);
  });

  it('AD11/AD17 nine calendar months with clamping; exam date never re-anchors', () => {
    expect(planEndDate(fx('AD11').input.start_date)).toBe(fx('AD11').expected.base_end_date);
    expect(planEndDate(fx('AD17').input.start_date)).toBe(fx('AD17').expected.base_end_date);
    expect(addMonthsClamped('2027-01-31', 1)).toBe('2027-02-28');
    expect(addMonthsClamped('2027-12-31', 2)).toBe('2028-02-29');
  });

  it('AD13/RET-01..03 retention requires unassisted D7 and D28', () => {
    expect(isRetained({ D7: true, D28: false, assisted: false })).toBe(false);
    expect(isRetained({ D7: true, D28: true, assisted: true })).toBe(false);
    expect(isRetained({ D7: true, D28: true, assisted: false })).toBe(true);
    const r = deriveCompetencyState([ev({ item_id: 'A' }), ev({ item_id: 'B' }), ev({ event_type: 'review_passed', review_interval_days: 7, item_id: 'C' })], false);
    expect(r.state).not.toBe('retained');
  });

  it('AD14 appeal freezes negative updates', () => {
    const neg = ev({ event_type: 'independent_incorrect', meaning_changing: true, frozen: true, created_at: '2026-10-02T00:00:00Z' });
    const r = deriveCompetencyState([ev({ item_id: 'A' }), ev({ item_id: 'B' }), neg], false);
    expect(r.state).toBe('controlled');
  });

  it('AD15 stable tie-break: never seen, oldest, then item_id', () => {
    expect(orderItems([{ item_id: 'I02', last_seen_at: null }, { item_id: 'I01', last_seen_at: null }])[0].item_id).toBe('I01');
  });

  it('AD16 all content blocked returns NO_ELIGIBLE_CONTENT', () => {
    expect(redistribute(splitBudget(60), { weak: false, strong: false, retention: false, new_content: false, independent_application: false }).status).toBe('NO_ELIGIBLE_CONTENT');
  });

  it('AD18 half-open 14 day UTC window', () => {
    const f = fx('AD18');
    const included = f.input.event_times.map((t: string, i: number) => (inUtcWindow(t, f.input.as_of_utc, 14) ? i : -1)).filter((i: number) => i >= 0);
    expect(included).toEqual(f.expected.included_indices);
  });

  it('AD19 prerequisite outdegree counts direct dependents', () => {
    expect(prerequisiteOutdegree(fx('AD19').input.node_prerequisites)).toEqual(fx('AD19').expected.prerequisite_outdegree);
  });

  it('weak ranking and 4:1 slot pattern are deterministic', () => {
    const ranked = rankWeak([
      { competency_id: 'B', reliable_errors_14d: 2, outdegree: 1, overdue_days: 0, relevance: 0 },
      { competency_id: 'A', reliable_errors_14d: 2, outdegree: 1, overdue_days: 0, relevance: 0 },
      { competency_id: 'C', reliable_errors_14d: 3, outdegree: 0, overdue_days: 0, relevance: 0 },
    ]);
    expect(ranked.map((r) => r.competency_id)).toEqual(['C', 'A', 'B']);
    expect([0, 1, 2, 3, 4].map((i) => correctiveSlotKind(i, true, true))).toEqual(['weak', 'weak', 'weak', 'weak', 'strong']);
    expect(correctiveSlotKind(4, true, false)).toBe('weak');
  });
});

describe('FINALIZATION_ACCEPTANCE_FIXTURES', () => {
  for (const f of finalization.fixtures) {
    it(`${f.id} ${f.operation}`, () => {
      if (f.operation === 'publication') expect(publicationAllowed(f.input)).toBe(f.expected);
      if (f.operation === 'negative_mastery') expect(negativeUpdateAllowed({ confirmed: f.input.confirmed, technicalFailure: f.input.technical_failure, assisted: f.input.assisted })).toBe(f.expected);
      if (f.operation === 'retention') expect(isRetained(f.input)).toBe(f.expected);
      if (f.operation === 'tutoring') expect(itemEligibility({ released: true, requiresAudio: false, audioVerified: false, pool: f.input.pool, mode: 'tutoring', usedInSession: false, prerequisitesKnownUnmet: false }).eligible).toBe(f.expected);
      if (f.operation === 'known_minutes') expect(knownMinutes(f.input.estimate)).toBe(f.expected);
      if (f.operation === 'raw_access') {
        const allowed = f.input.requester === f.input.owner || (f.input.admin && f.input.scoped_consent);
        expect(allowed).toBe(f.expected);
      }
    });
  }
});

describe('local calendar and D7/D28 anchoring', () => {
  it('local date follows the learner timezone, not UTC', () => {
    const instant = new Date('2026-10-31T22:30:00Z');
    expect(localDateOf(instant, 'Europe/Athens')).toBe('2026-11-01');
    expect(localDateOf(instant, 'America/New_York')).toBe('2026-10-31');
  });

  it('ladder anchors on the attempt local date and crosses month ends', () => {
    let i = 0;
    const rows = scheduleLadder({ userId: 'u', competencyId: 'A1-G01', anchorAttemptId: 'a', anchorItemId: 'X', anchorLocalDate: '2027-01-31', contentHash: 'h', hasActiveLadder: false, newId: () => `r${i++}` });
    expect(rows.map((r) => r.due_local_date)).toEqual(['2027-02-01', '2027-02-03', '2027-02-07', '2027-02-14', '2027-02-28']);
    expect(scheduleLadder({ userId: 'u', competencyId: 'A1-G01', anchorAttemptId: 'a', anchorItemId: 'X', anchorLocalDate: '2027-01-31', contentHash: 'h', hasActiveLadder: true, newId: () => 'z' })).toEqual([]);
  });

  it('review probe: early, same-item, assisted or unreliable attempts do not pass', () => {
    const r = { id: 'r', competency_id: 'c', anchor_attempt_id: 'a', anchor_item_id: 'X', anchor_local_date: '2026-10-01', interval_days: 7 as const, due_local_date: addDays('2026-10-01', 7), status: 'due' as const };
    expect(resolveReview(r, { itemId: 'Y', localDate: '2026-10-07', assisted: false, reliable: true, correct: true })).toBe('no_change');
    expect(resolveReview(r, { itemId: 'X', localDate: '2026-10-08', assisted: false, reliable: true, correct: true })).toBe('no_change');
    expect(resolveReview(r, { itemId: 'Y', localDate: '2026-10-08', assisted: true, reliable: true, correct: true })).toBe('assisted');
    expect(resolveReview(r, { itemId: 'Y', localDate: '2026-10-08', assisted: false, reliable: false, correct: false })).toBe('no_change');
    expect(resolveReview(r, { itemId: 'Y', localDate: '2026-11-20', assisted: false, reliable: true, correct: true })).toBe('passed');
  });
});
