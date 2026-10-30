import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { admin, createUser, deleteUser, type TestUser } from './helpers';
import { decideAudioRelease, recordListening } from '@/lib/qa/audio-release';
import { buildWav } from '@/lib/audio/wav';

/**
 * v6 audio release: a file reaches learners only after the owner listened to it and decided under the
 * signed policy; the release cites a QA snapshot batch and the decision. Fixtures are clearly labelled
 * synthetic silence; the temporary policy and every row are removed afterwards.
 */
let owner: TestUser;
let policyId = '';
const assets: string[] = [];
const paths: string[] = [];

async function fixtureAsset(rights: string): Promise<string> {
  const { data: job } = await admin.from('audio_jobs').select('audio_id, script_hash').eq('audio_id', 'U-A1-006-AUD01').single();
  const wav = buildWav(new Int16Array(16000 + Math.floor(Math.random() * 1000)), 16000);
  const sha = createHash('sha256').update(wav).digest('hex');
  const path = `SYN-TEST/${sha}.wav`;
  await admin.storage.from('course-audio').upload(path, wav, { contentType: 'audio/wav', upsert: true });
  paths.push(path);
  const { data, error } = await admin.from('audio_assets').insert({
    audio_id: job!.audio_id, script_hash: job!.script_hash, idempotency_key: `syn-rel-${randomUUID()}`, provider: 'local_coqui', model: 'SYNTHETIC-TEST-FIXTURE', voice_map: {},
    object_path: path, mime_type: 'audio/wav', sha256: sha, byte_length: wav.byteLength, duration_ms: 1000, technical_status: 'TECHNICAL_PASS',
    digital_status: 'AUDIO_VERIFIED_DIGITAL', rights_status: rights, render_status: 'DIGITAL_REVIEWED', cast_approved: true,
  }).select('id').single();
  if (error) throw error;
  assets.push(data.id);
  return data.id;
}

beforeAll(async () => {
  owner = await createUser({ owner: true });
  const { data: pol, error } = await admin.from('publication_policies').insert({ kind: 'DIGITAL_ONLY_RISK_ACCEPTED', version: 'TEST-ONLY', statement_ru: 'Синтетическая тестовая политика (автотест)', risks_acknowledged: ['test'], signed_by: owner.id }).select('id').single();
  if (error) throw error;
  policyId = pol.id;
});

afterAll(async () => {
  const { data: rels } = await admin.from('content_releases').select('decision_id, qa_batch_id').in('content_id', assets);
  await admin.from('content_releases').delete().in('content_id', assets);
  const decisions = [...new Set((rels ?? []).map((r) => r.decision_id).filter(Boolean))];
  const batches = [...new Set((rels ?? []).map((r) => r.qa_batch_id).filter(Boolean))];
  if (decisions.length) await admin.from('release_decisions').delete().in('id', decisions);
  if (batches.length) await admin.from('qa_batches').delete().in('id', batches);
  await admin.from('release_decisions').delete().eq('policy_id', policyId);
  if (policyId) await admin.from('publication_policies').delete().eq('id', policyId);
  if (assets.length) await admin.from('audio_assets').delete().in('id', assets);
  if (paths.length) await admin.storage.from('course-audio').remove(paths);
  if (owner) await deleteUser(owner);
});

describe('audio release (v6)', () => {
  it('refuses a file the owner has not listened to, and a development-only voice', async () => {
    const a = await fixtureAsset('PROVIDER_TERMS_RECORDED');
    await expect(decideAudioRelease(owner.session, { asset_ids: [a] })).rejects.toMatchObject({ code: 'NOT_ELIGIBLE' });
    const dev = await fixtureAsset('DEV_LOCAL_ONLY');
    await recordListening(owner.session, { asset_id: dev, decision: 'OK' });
    await expect(decideAudioRelease(owner.session, { asset_ids: [dev] })).rejects.toThrow(/только для разработки/);
  });

  it('a problem heard by the owner blocks release; OK + signed policy releases with batch and decision', async () => {
    const a = await fixtureAsset('PROVIDER_TERMS_RECORDED');
    await expect(recordListening(owner.session, { asset_id: a, decision: 'ISSUE' })).rejects.toMatchObject({ code: 'NOTE_REQUIRED' });
    await recordListening(owner.session, { asset_id: a, decision: 'ISSUE', note: 'ударение в «έρχεσαι»' });
    await expect(decideAudioRelease(owner.session, { asset_ids: [a] })).rejects.toThrow(/проблема/);
    await recordListening(owner.session, { asset_id: a, decision: 'OK' });
    const r = await decideAudioRelease(owner.session, { asset_ids: [a] });
    expect(r.released).toBe(1);
    const { data: rel } = await admin.from('content_releases').select('review_type, qa_batch_id, decision_id, policy_id, scope').eq('content_id', a).is('revoked_at', null).single();
    expect(rel).toMatchObject({ review_type: 'OWNER_DIGITAL_POLICY', qa_batch_id: r.batch_id, decision_id: r.decision_id, policy_id: policyId, scope: 'audio_playback' });
    const again = await decideAudioRelease(owner.session, { asset_ids: [a] });
    expect(again).toMatchObject({ released: 0, already_released: 1 });
  });
});
