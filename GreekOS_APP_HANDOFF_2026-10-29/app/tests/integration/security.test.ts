import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, anon, createUser, deleteUser, upsertSynItem, synItem, type TestUser } from './helpers';

/** Real Postgres RLS / grants against the local Supabase stack (not mocks). */
let A: TestUser;
let B: TestUser;
let OWNER: TestUser;

beforeAll(async () => {
  [A, B, OWNER] = await Promise.all([createUser(), createUser(), createUser({ owner: true })]);
  const hash = await upsertSynItem(synItem('SYN-SEC-1', {}), { release: true });
  // Seed one attempt for B through the trusted commit function.
  const { error } = await admin.rpc('commit_learning_event', {
    p: {
      user_id: B.id, idempotency_key: `seed-${B.id}`, scope: 'test',
      attempt: { attempt_id: crypto.randomUUID(), user_id: B.id, item_id: 'SYN-SEC-1', content_hash: hash, context: 'lesson', context_ref: null, response_private: { text: 'είναι' }, assistance: 'none', released_snapshot: true, preview: false, idempotency_key: `seed-${B.id}`, local_date: '2026-10-28', timezone: 'Europe/Athens', active_ms: null, created_at: new Date().toISOString() },
      events: [{ event_type: 'exercise_submitted', idempotency_key: `seed-${B.id}`, payload: {} }],
      result: { ok: true },
    },
  });
  if (error) throw error;
  await admin.storage.from('voice-review').upload(`${B.id}/s1/test.wav`, new Uint8Array([82, 73, 70, 70]), { contentType: 'audio/wav', upsert: true });
});

afterAll(async () => {
  await admin.from('content_releases').delete().like('content_id', 'SYN-SEC-%');
  await admin.storage.from('voice-review').remove([`${B.id}/s1/test.wav`]);
  await Promise.all([A, B, OWNER].filter(Boolean).map(deleteUser));
  await admin.from('items').delete().like('item_id', 'SYN-SEC-%');
});

describe('cross-learner isolation (RLS)', () => {
  it('learner A cannot read learner B attempts, events or profile even by forged id', async () => {
    const { data: attempts } = await A.client.from('attempts').select('*').eq('user_id', B.id);
    expect(attempts).toEqual([]);
    const { data: events } = await A.client.from('learner_events').select('*').eq('user_id', B.id);
    expect(events).toEqual([]);
    const { data: prof } = await A.client.from('profiles').select('*').eq('user_id', B.id);
    expect(prof).toEqual([]);
  });

  it('learner B sees own rows', async () => {
    const { data } = await B.client.from('attempts').select('attempt_id, user_id');
    expect(data?.length).toBe(1);
    expect(data?.[0].user_id).toBe(B.id);
  });

  it('learners cannot write learner state directly (scores, mastery, attempts)', async () => {
    const ins = await A.client.from('attempts').insert({ user_id: A.id, item_id: 'SYN-SEC-1', content_hash: 'x'.repeat(64), context: 'lesson', response_private: {}, released_snapshot: true, idempotency_key: 'forged-attempt', local_date: '2026-10-28', timezone: 'UTC' });
    expect(ins.error).not.toBeNull();
    const mastery = await A.client.from('mastery_events').insert({ user_id: A.id, competency_id: 'A1-G05', event_type: 'independent_correct', reliable: true, local_date: '2026-10-28' });
    expect(mastery.error).not.toBeNull();
    const del = await B.client.from('attempts').delete().eq('user_id', B.id).select();
    expect(del.error !== null || (del.data ?? []).length === 0).toBe(true);
  });

  it('learner cannot grant itself owner_admin or release content', async () => {
    const role = await A.client.from('role_assignments').insert({ user_id: A.id, role: 'owner_admin' });
    expect(role.error).not.toBeNull();
    const upd = await A.client.from('profiles').update({ active: true, lifecycle_state: 'studying' }).eq('user_id', A.id).select();
    expect(upd.error !== null || (upd.data ?? []).length === 0).toBe(true);
    const rel = await A.client.from('content_releases').insert({ content_kind: 'item', content_id: 'D-A1-GRAMMAR-01', content_hash: 'a'.repeat(64), review_type: 'OWNER_DIGITAL_POLICY', reviewer_identity: 'me', method: 'x', scope: 'learner_practice', decision: 'APPROVED', rights_scope: 'x' });
    expect(rel.error).not.toBeNull();
  });

  it('canonical content, keys and releases are not readable through the public API', async () => {
    for (const table of ['items', 'content_revisions', 'units', 'rubrics', 'exam_forms', 'content_releases', 'audio_jobs', 'admin_audit_log', 'provider_usage']) {
      const { data, error } = await A.client.from(table).select('*').limit(1);
      expect(error !== null || (data ?? []).length === 0, table).toBe(true);
    }
    const { data, error } = await anon().from('profiles').select('*').limit(1);
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });

  it('trusted RPCs are not callable by learners', async () => {
    const r1 = await A.client.rpc('commit_learning_event', { p: { user_id: B.id, idempotency_key: 'forge-12345' } });
    expect(r1.error).not.toBeNull();
    const r2 = await A.client.rpc('admin_revoke_user_sessions', { target: B.id });
    expect(r2.error).not.toBeNull();
  });

  it('commit function rejects bundles mixing ownership', async () => {
    const { error } = await admin.rpc('commit_learning_event', {
      p: { user_id: A.id, idempotency_key: `mix-${A.id}`, error_evidence: [{ user_id: B.id }], result: {} },
    });
    expect(error?.message).toMatch(/ownership mismatch/);
  });

  it('owner_admin has no direct REST access to raw speaking turns of a learner', async () => {
    const { data } = await OWNER.client.from('speaking_turns').select('*').eq('user_id', B.id);
    expect(data).toEqual([]);
  });

  it('private storage: other users cannot download voice recordings; no public URLs', async () => {
    const { data, error } = await A.client.storage.from('voice-review').download(`${B.id}/s1/test.wav`);
    expect(data).toBeNull();
    expect(error).not.toBeNull();
    const { data: buckets } = await admin.storage.listBuckets();
    expect(buckets?.filter((b) => ['course-audio', 'tts-cache', 'voice-review'].includes(b.id)).every((b) => !b.public)).toBe(true);
  });

  it('append-only audit log and immutable content revisions', async () => {
    await admin.from('admin_audit_log').insert({ action: 'test.event', meta: {} });
    const { data } = await admin.from('admin_audit_log').select('event_id').eq('action', 'test.event').limit(1).single();
    const upd = await admin.from('admin_audit_log').update({ action: 'tampered' }).eq('event_id', data!.event_id);
    expect(upd.error?.message).toMatch(/immutable/);
    const rev = await admin.from('content_revisions').update({ module: 'x' }).eq('content_id', 'SYN-SEC-1');
    expect(rev.error?.message).toMatch(/immutable/);
  });

  it('deactivated learner loses access immediately (RLS) and cannot commit', async () => {
    const C = await createUser();
    await admin.from('profiles').update({ active: false }).eq('user_id', C.id);
    const { data } = await C.client.from('enrollments').select('*');
    expect(data).toEqual([]);
    const { error } = await admin.rpc('commit_learning_event', { p: { user_id: C.id, idempotency_key: `deact-${C.id}`, result: {} } });
    expect(error?.message).toMatch(/inactive/);
    await deleteUser(C);
  });

  it('public sign-up is disabled (invite-only)', async () => {
    const { error } = await anon().auth.signUp({ email: `walkin-${Date.now()}@greekos.test`, password: 'x'.repeat(16) });
    expect(error).not.toBeNull();
  });
});
