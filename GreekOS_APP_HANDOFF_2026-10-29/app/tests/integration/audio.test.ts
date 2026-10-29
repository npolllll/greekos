import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin } from './helpers';
import { renderJob, planJob, loadCastingContext } from '@/lib/audio/pipeline';
import { syncLocalVoices, proposeCastVoices, proposeJobCasting } from '@/lib/voice/catalog';
import { normalizeAudioJob } from '@/lib/admin/audio';

/**
 * Audio pipeline against the real local database and storage. On macOS the local System Voice
 * renders REAL Greek speech (development rights only); the mock transport is checked separately.
 */
const created: string[] = [];
// Rendering supersedes the job's current local asset; the test restores it so local data is unchanged.
const restore: { assets: string[]; status: Record<string, unknown> | null } = { assets: [], status: null };
const isMac = process.platform === 'darwin';

beforeAll(async () => {
  process.env.APP_ENV = 'local';
  if (isMac) {
    await syncLocalVoices();
    await proposeCastVoices();
    await proposeJobCasting();
  }
});

afterAll(async () => {
  if (restore.assets.length) await admin.from('audio_assets').update({ invalidated_at: null, invalidated_reason: null }).in('id', restore.assets);
  if (restore.status) await admin.from('audio_job_render_status').upsert(restore.status);
  for (const id of created) {
    const { data } = await admin.from('audio_assets').select('object_path, master_object_path').eq('id', id).single();
    await admin.storage.from('course-audio').remove([data?.object_path, data?.master_object_path].filter(Boolean) as string[]);
    await admin.from('digital_qa_runs').delete().eq('content_id', id);
    await admin.from('audio_job_render_status').update({ last_asset_id: null }).eq('last_asset_id', id).neq('audio_id', 'U-A1-019-AUD01');
    await admin.from('audio_assets').delete().eq('id', id);
  }
});

const loadJob = async (id: string) => {
  const { data } = await admin.from('audio_jobs').select('audio_id, script_hash, text_el, segments, payload').eq('audio_id', id).single();
  return normalizeAudioJob(data as never);
};

describe('digital audio pipeline', () => {
  it.skipIf(!isMac)('renders a narrator job with a real local Greek voice, measured and stored, never distributable', async () => {
    const job = await loadJob('U-A1-019-AUD01');
    restore.assets = ((await admin.from('audio_assets').select('id').eq('audio_id', job.audio_id).is('invalidated_at', null)).data ?? []).map((a) => a.id);
    restore.status = (await admin.from('audio_job_render_status').select('*').eq('audio_id', job.audio_id).maybeSingle()).data;
    const ctx = await loadCastingContext();
    const p = planJob(job, ctx);
    expect(p.ok).toBe(true);
    const r = await renderJob(job, { actorId: null, budgetCapUsd: 0, ctx, force: true });
    expect(r.status).toBe('RENDERED');
    created.push(r.asset_id!);
    const { data: a } = await admin.from('audio_assets').select('*').eq('id', r.asset_id!).single();
    expect(a.provider).toBe('local_macos');
    expect(a.technical_status).toBe('TECHNICAL_PASS');
    expect(a.duration_ms).toBeGreaterThan(300);
    expect(a.rights_status).toBe('DEV_LOCAL_ONLY');
    expect(a.cast_approved).toBe(false);
    expect(a.master_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(['DIGITAL_REVIEWED', 'LINGUISTIC_QA_PENDING']).toContain(a.render_status);
    const { data: file } = await admin.storage.from('course-audio').download(a.object_path);
    expect(new Uint8Array(await file!.arrayBuffer()).slice(0, 4)).toEqual(new Uint8Array([82, 73, 70, 70]));
    const forced = await admin.from('audio_assets').update({ render_status: 'RELEASE_ELIGIBLE' }).eq('id', r.asset_id!);
    expect(forced.error?.message).toMatch(/release_eligible_requirements/);
  }, 600_000);

  it.skipIf(!isMac)('dialogue with uncast personal names is blocked with a reason, not rendered with a guessed voice', async () => {
    const r = await renderJob(await loadJob('U-A1-001-AUD01'), { actorId: null, budgetCapUsd: 0 });
    expect(r.status).toBe('BLOCKED');
    expect(r.job_status).toBe('BLOCKED_MISSING_VOICE_METADATA');
    const { data } = await admin.from('audio_job_render_status').select('status, reason').eq('audio_id', 'U-A1-001-AUD01').single();
    expect(data!.status).toBe('BLOCKED_MISSING_VOICE_METADATA');
  });

  it('mock transport can never become publishable audio (DB guard)', async () => {
    const { data, error } = await admin.from('audio_assets').insert({
      audio_id: 'U-A1-019-AUD01', script_hash: 'x', idempotency_key: `mock-${Date.now()}`, provider: 'mock', voice_map: {}, render_status: 'DIGITAL_REVIEWED', digital_status: 'PENDING',
    }).select('id');
    expect(data ?? []).toEqual([]);
    expect(error?.message).toMatch(/audio_assets_mock_never_verified/);
  });
});
