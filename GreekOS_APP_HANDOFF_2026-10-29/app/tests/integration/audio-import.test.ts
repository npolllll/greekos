import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { admin } from './helpers';
import { importJobAudio } from '@/lib/audio/import';
import { localAsrHealth } from '@/lib/providers/local-engines';

/**
 * Import of a finished recording for one job: real bytes from the audio bundle go through technical
 * QA and the ASR round-trip against the job's own script. The test restores the job's current asset.
 */
const BUNDLE = new URL('../../../audio_bundle/', import.meta.url);
const OWN = 'files/U-A1-019-AUD01/e584cbf0f85115aff8edfce898cb9e5a07fb30ac62caec01c410c7913d8707b1.wav';
const OTHER = 'files/U-A1-020-AUD01/9e898bda2e7f5b5d83de47117feb1ada4323318189dad50fe1a39c2e1bebf96d.wav';
const have = existsSync(new URL(OWN, BUNDLE)) && existsSync(new URL(OTHER, BUNDLE));
let asr = false;
const created: string[] = [];
const restore: { assets: string[]; status: Record<string, unknown> | null } = { assets: [], status: null };

beforeAll(async () => {
  process.env.APP_ENV = 'local';
  asr = !!(await localAsrHealth())?.available?.length;
  restore.assets = ((await admin.from('audio_assets').select('id').eq('audio_id', 'U-A1-019-AUD01').is('invalidated_at', null)).data ?? []).map((a) => a.id);
  restore.status = (await admin.from('audio_job_render_status').select('*').eq('audio_id', 'U-A1-019-AUD01').maybeSingle()).data;
});

afterAll(async () => {
  for (const id of created) {
    const { data } = await admin.from('audio_assets').select('object_path, master_object_path').eq('id', id).single();
    await admin.storage.from('course-audio').remove([data?.object_path, data?.master_object_path].filter(Boolean) as string[]);
    await admin.from('digital_qa_runs').delete().eq('content_id', id);
    await admin.from('audio_assets').delete().eq('id', id);
  }
  if (restore.assets.length) await admin.from('audio_assets').update({ invalidated_at: null, invalidated_reason: null }).in('id', restore.assets);
  if (restore.status) await admin.from('audio_job_render_status').upsert(restore.status);
});

describe('import of a finished recording', () => {
  it.skipIf(!have)('the job\'s own recording passes digital QA and supersedes the previous file; rights stay pending', async () => {
    const r = await importJobAudio('U-A1-019-AUD01', new Uint8Array(readFileSync(new URL(OWN, BUNDLE))), { provider: 'Test studio', voices: {}, note: 'integration test' }, null);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    created.push(r.asset_id);
    expect(r.technical_pass).toBe(true);
    if (asr) expect(r).toMatchObject({ digital_status: 'AUDIO_VERIFIED_DIGITAL', roundtrip: { pass: true } });
    const { data: a } = await admin.from('audio_assets').select('provider, rights_status, cast_approved, invalidated_at, master_sha256').eq('id', r.asset_id).single();
    expect(a).toMatchObject({ provider: 'external_import', rights_status: 'RIGHTS_PENDING', cast_approved: false, invalidated_at: null });
    const { data: prev } = await admin.from('audio_assets').select('invalidated_reason').in('id', restore.assets);
    expect((prev ?? []).every((p) => p.invalidated_reason === 'SUPERSEDED_BY_IMPORT')).toBe(true);
    // The same bytes again are refused (idempotent by master hash).
    const again = await importJobAudio('U-A1-019-AUD01', new Uint8Array(readFileSync(new URL(OWN, BUNDLE))), { provider: 'Test studio', voices: {} }, null);
    expect(again).toMatchObject({ ok: false, error: 'STALE' });
  });

  it.skipIf(!have)('a recording of another script does not pass the round-trip: it goes to review', async () => {
    const r = await importJobAudio('U-A1-019-AUD01', new Uint8Array(readFileSync(new URL(OTHER, BUNDLE))), { provider: 'Test studio', voices: {} }, null);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    created.push(r.asset_id);
    expect(r.digital_status).toBe(asr ? 'NEEDS_REVIEW' : 'NEEDS_REVIEW');
    if (asr) expect(r.roundtrip?.pass).toBe(false);
  });

  it('a file that is not a PCM WAV is refused before anything is stored', async () => {
    const r = await importJobAudio('U-A1-019-AUD01', new TextEncoder().encode('not audio'), { provider: 'x', voices: {} }, null);
    expect(r).toMatchObject({ ok: false, error: 'NOT_WAV' });
  });
});
