import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, createUser, deleteUser, upsertSynItem, synItem, type TestUser } from './helpers';
import { submitAttempt } from '@/lib/learning/attempts';
import { releaseMap } from '@/lib/content/repo';

/** Server-authoritative learning flow against the real local database. */
let L: TestUser;
let OWNER: TestUser;
const H: Record<string, string> = {};

beforeAll(async () => {
  [L, OWNER] = await Promise.all([createUser(), createUser({ owner: true })]);
  H.s1 = await upsertSynItem(synItem('SYN-LRN-1', { answer: ['είναι'] }), { release: true });
  H.s2 = await upsertSynItem(synItem('SYN-LRN-2', { prompt: 'Συμπληρώστε: Εγώ ___ φοιτητής.', answer: ['είμαι'] }), { release: true });
  H.mcq = await upsertSynItem(synItem('SYN-LRN-MCQ', { type: 'mcq', options: ['φούρνος', 'κλειδί'], answer: ['φούρνος'], scoring: { strategy: 'CHOICE_KEY', policy: {}, automatic_final_score_allowed: false, unlisted_answer: 'HOLD_FOR_REVIEW_NO_PENALTY' } }), { release: true });
  H.gated = await upsertSynItem(synItem('SYN-LRN-GATED', {}), { release: false });
  H.hold = await upsertSynItem(synItem('SYN-LRN-HOLD', {}), { release: true, pool: 'diagnostic_holdout', section: null });
});

afterAll(async () => {
  await admin.from('content_releases').delete().like('content_id', 'SYN-LRN-%');
  await Promise.all([L, OWNER].filter(Boolean).map(deleteUser));
  await admin.from('items').delete().like('item_id', 'SYN-LRN-%');
});

const req = (item: string, hash: string, text: string, extra: Record<string, unknown> = {}) => ({
  item_id: item, content_hash: hash, response: { text }, assistance: 'none' as const, context: 'lesson' as const,
  response_source: 'typed' as const, idempotency_key: `k-${crypto.randomUUID()}`, ...extra,
});

describe('content gating', () => {
  it('a gated item is refused for learners (no fabricated access)', async () => {
    await expect(submitAttempt(L.session, req('SYN-LRN-GATED', H.gated, 'είναι'))).rejects.toMatchObject({ status: 403, code: 'CONTENT_GATED' });
  });
  it('a holdout diagnostic item cannot be used as a routine drill', async () => {
    await expect(submitAttempt(L.session, req('SYN-LRN-HOLD', H.hold, 'είναι'))).rejects.toMatchObject({ status: 403, code: 'HOLDOUT' });
  });
  it('a stale content hash is rejected (content changed)', async () => {
    await expect(submitAttempt(L.session, req('SYN-LRN-1', 'f'.repeat(64), 'είναι'))).rejects.toMatchObject({ status: 409 });
  });
  it('changing an item hash invalidates its release', async () => {
    const env = synItem('SYN-LRN-REV', {});
    const h1 = await upsertSynItem(env, { release: true });
    expect((await releaseMap('item', [{ id: 'SYN-LRN-REV', hash: h1 }])).has('SYN-LRN-REV')).toBe(true);
    const h2 = await upsertSynItem({ ...env, prompt: 'Συμπληρώστε: Ο Νίκος ___ εδώ.' });
    expect(h2).not.toBe(h1);
    expect((await releaseMap('item', [{ id: 'SYN-LRN-REV', hash: h2 }])).has('SYN-LRN-REV')).toBe(false);
  });
});

describe('attempts are idempotent and server-scored', () => {
  it('network retry with the same key records one attempt', async () => {
    const r = req('SYN-LRN-1', H.s1, 'είναι');
    const first = await submitAttempt(L.session, r);
    const second = await submitAttempt(L.session, r);
    expect(first.verdict).toBe('CORRECT');
    expect(second.replayed).toBe(true);
    const { count } = await admin.from('attempts').select('attempt_id', { count: 'exact', head: true }).eq('user_id', L.id).eq('idempotency_key', r.idempotency_key);
    expect(count).toBe(1);
    const { count: ev } = await admin.from('learner_events').select('id', { count: 'exact', head: true }).eq('user_id', L.id).eq('idempotency_key', r.idempotency_key).eq('event_type', 'exercise_submitted');
    expect(ev).toBe(1);
  });

  it('unlisted plausible answer goes to review without penalty and without mastery', async () => {
    const r = await submitAttempt(L.session, req('SYN-LRN-2', H.s2, 'ήμουν'));
    expect(['PENDING_REVIEW', 'ABSTAIN']).toContain(r.verdict);
    expect(r.mastery_counted).toBe(false);
    const { count } = await admin.from('error_evidence').select('id', { count: 'exact', head: true }).eq('attempt_id', r.attempt_id);
    expect(count).toBe(0);
  });

  it('a confirmed wrong choice creates evidence in the Error Notebook', async () => {
    const r = await submitAttempt(L.session, { ...req('SYN-LRN-MCQ', H.mcq, ''), response: { choice: '1' } });
    expect(r.verdict).toBe('INCORRECT_CONFIRMED');
    const { data } = await admin.from('error_evidence').select('verdict, competency_id, status').eq('attempt_id', r.attempt_id);
    expect(data).toEqual([{ verdict: 'INCORRECT_CONFIRMED', competency_id: 'A1-G05', status: 'open' }]);
  });

  it('assisted attempts never advance independent mastery', async () => {
    const r = await submitAttempt(L.session, req('SYN-LRN-2', H.s2, 'είμαι', { assistance: 'retry_after_model' }));
    expect(r.verdict).toBe('CORRECT');
    expect(r.mastery_counted).toBe(false);
    const { data } = await admin.from('mastery_events').select('event_type, reliable').eq('attempt_id', r.attempt_id);
    expect(data?.every((e) => e.event_type === 'assisted_observation' && !e.reliable)).toBe(true);
  });

  it('independent correct answers schedule D1…D28 on the learner-local date', async () => {
    const r = await submitAttempt(L.session, req('SYN-LRN-2', H.s2, 'είμαι'));
    expect(r.mastery_counted).toBe(true);
    const { data } = await admin.from('spaced_reviews').select('interval_days, due_local_date, anchor_local_date').eq('user_id', L.id).eq('competency_id', 'A1-G05').order('interval_days');
    expect(data?.map((d) => d.interval_days)).toEqual([1, 3, 7, 14, 28]);
    const { data: st } = await admin.from('competency_state').select('state').eq('user_id', L.id).eq('competency_id', 'A1-G05').single();
    expect(['familiar', 'controlled', 'recognition', 'needs_review', 'retention_due']).toContain(st!.state);
    expect(['retained', 'transfer_confirmed']).not.toContain(st!.state);
  });

  it('owner preview of gated content writes no mastery, reviews or errors', async () => {
    const r = await submitAttempt(OWNER.session, req('SYN-LRN-GATED', H.gated, 'λάθος', { context: 'preview' }));
    expect(r.preview).toBe(true);
    const [{ count: m }, { count: e }] = await Promise.all([
      admin.from('mastery_events').select('event_id', { count: 'exact', head: true }).eq('attempt_id', r.attempt_id),
      admin.from('error_evidence').select('id', { count: 'exact', head: true }).eq('attempt_id', r.attempt_id),
    ]);
    expect(m).toBe(0);
    expect(e).toBe(0);
  });

  it('learners cannot use preview context', async () => {
    await expect(submitAttempt(L.session, req('SYN-LRN-GATED', H.gated, 'είναι', { context: 'preview' }))).rejects.toMatchObject({ status: 403 });
  });
});
