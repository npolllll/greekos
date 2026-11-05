import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { admin, createUser, deleteUser, type TestUser } from './helpers';
import { examAudioPlay } from '@/lib/exams/service';
import { buildWav } from '@/lib/audio/wav';

/**
 * A06: exam listening plays are counted on the server. A clearly labelled synthetic fixture asset
 * (silence, SYNTHETIC-TEST-FIXTURE) is released only for the duration of this test.
 */
let learner: TestUser;
let other: TestUser;
let owner: TestUser;
let policyId = '';
let batchId = '';
let decisionId = '';
let assetId = '';
let objectPath = '';
const attempts: string[] = [];

beforeAll(async () => {
  learner = await createUser();
  other = await createUser();
  const { data: job } = await admin.from('audio_jobs').select('audio_id, script_hash').eq('audio_id', 'KEG-B2-L01-AUD1').single();
  const wav = buildWav(new Int16Array(16000), 16000);
  const sha = createHash('sha256').update(wav).digest('hex');
  objectPath = `SYN-TEST/${sha}.wav`;
  await admin.storage.from('course-audio').upload(objectPath, wav, { contentType: 'audio/wav', upsert: true });
  const { data: a, error } = await admin.from('audio_assets').insert({
    audio_id: job!.audio_id, script_hash: job!.script_hash, idempotency_key: `syn-exam-${randomUUID()}`, provider: 'local_macos', model: 'SYNTHETIC-TEST-FIXTURE', voice_map: {},
    object_path: objectPath, mime_type: 'audio/wav', sha256: sha, byte_length: wav.byteLength, duration_ms: 1000, technical_status: 'TECHNICAL_PASS',
    digital_status: 'AUDIO_VERIFIED_DIGITAL', rights_status: 'PROVIDER_TERMS_RECORDED', render_status: 'DIGITAL_REVIEWED',
  }).select('id').single();
  if (error) throw error;
  assetId = a.id;
  // Asset ids are UUIDs, so the release needs a policy row; it is created already REVOKED so a crashed
  // run can never leave a "signed" policy behind in the local database.
  owner = await createUser({ owner: true });
  const { data: pol, error: pe } = await admin.from('publication_policies').insert({ kind: 'DIGITAL_ONLY_RISK_ACCEPTED', version: 'TEST-ONLY', statement_ru: 'Синтетическая тестовая политика (автотест)', risks_acknowledged: ['test'], signed_by: owner.id, revoked_at: new Date().toISOString(), revoked_by: owner.id }).select('id').single();
  if (pe) throw pe;
  policyId = pol.id;
  // v6: a policy release must cite the QA batch and the owner's release decision it came from.
  const { data: batch, error: be } = await admin.from('qa_batches').insert({ label: 'SYN-TEST exam audio', scope: { kind: 'test' }, tool_version: 'test', status: 'COMPLETED', finished_at: new Date().toISOString() }).select('id').single();
  if (be) throw be;
  batchId = batch.id;
  const { data: dec, error: de } = await admin.from('release_decisions').insert({ batch_id: batchId, policy_id: policyId, scope: { kind: 'test', audio_asset: assetId }, risk_acceptance: 'PASS_ONLY', sample_size: 0, sample_ok: 0, decided_by: owner.id }).select('id').single();
  if (de) throw de;
  decisionId = dec.id;
  const rel = await admin.from('content_releases').insert({ content_kind: 'audio_asset', content_id: assetId, content_hash: sha, review_type: 'OWNER_DIGITAL_POLICY', policy_id: policyId, qa_batch_id: batchId, decision_id: decisionId, reviewer_identity: 'automated test', reviewer_user_id: owner.id, method: 'synthetic fixture', scope: 'audio_playback', decision: 'APPROVED', rights_scope: 'test only' });
  if (rel.error) throw rel.error;
});

afterAll(async () => {
  for (const id of attempts) await admin.from('exam_attempts').delete().eq('id', id);
  await admin.from('content_releases').delete().eq('content_id', assetId);
  if (decisionId) await admin.from('release_decisions').delete().eq('id', decisionId);
  if (batchId) await admin.from('qa_batches').delete().eq('id', batchId);
  if (policyId) await admin.from('publication_policies').delete().eq('id', policyId);
  await admin.from('audio_assets').delete().eq('id', assetId);
  await admin.storage.from('course-audio').remove([objectPath]);
  await deleteUser(learner);
  await deleteUser(other);
  if (owner) await deleteUser(owner);
});

async function attempt(u: TestUser, mode: 'simulation' | 'practice') {
  const { data: c } = await admin.from('exam_components').select('current_hash').eq('component_id', 'KEG-B2-L01').single();
  const { data } = await admin.from('exam_attempts').insert({ user_id: u.id, component_id: 'KEG-B2-L01', component_hash: c!.current_hash, mode, server_expires_at: new Date(Date.now() + 3600_000).toISOString(), idempotency_key: randomUUID() }).select('id').single();
  attempts.push(data!.id);
  return data!.id as string;
}

describe('exam listening play limit (server-enforced)', () => {
  it('simulation: exactly two plays, then refused; counters persist on the attempt', async () => {
    const id = await attempt(learner, 'simulation');
    const p1 = await examAudioPlay(learner.session, id, assetId);
    expect(p1).toMatchObject({ plays_used: 1, plays_remaining: 1 });
    expect(p1.url).toMatch(/^http/);
    expect(await examAudioPlay(learner.session, id, assetId)).toMatchObject({ plays_used: 2, plays_remaining: 0 });
    await expect(examAudioPlay(learner.session, id, assetId)).rejects.toMatchObject({ code: 'NO_MORE_PLAYS' });
    const { data } = await admin.from('exam_attempts').select('audio_plays').eq('id', id).single();
    expect(data!.audio_plays).toEqual({ [assetId]: 2 });
  });

  it('parallel requests cannot exceed the limit', async () => {
    const id = await attempt(learner, 'simulation');
    const r = await Promise.allSettled([1, 2, 3, 4].map(() => examAudioPlay(learner.session, id, assetId)));
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(2);
  });

  it('practice is unlimited; other users and unknown assets are refused', async () => {
    const id = await attempt(learner, 'practice');
    for (let i = 0; i < 3; i++) expect((await examAudioPlay(learner.session, id, assetId)).plays_remaining).toBeNull();
    await expect(examAudioPlay(other.session, id, assetId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(examAudioPlay(learner.session, id, randomUUID())).rejects.toMatchObject({ code: 'AUDIO_PENDING' });
  });
});
