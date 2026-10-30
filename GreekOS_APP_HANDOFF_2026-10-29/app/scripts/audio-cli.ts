/**
 * greekos-audio — provider-neutral audio CLI (AUDIO_EXECUTION_PACK/ADAPTER_CONTRACT.md).
 *
 *   npx tsx scripts/audio-cli.ts validate
 *   npx tsx scripts/audio-cli.ts cast                                   # sync voice catalog + casting proposals
 *   npx tsx scripts/audio-cli.ts plan --ids KEG-B2-L01-AUD1,KEG-B2-L01-AUD2
 *   npx tsx scripts/audio-cli.ts render --ids KEG-B2-L01-AUD1 --approved-plan-hash <sha256> --budget-cap 2
 *   npx tsx scripts/audio-cli.ts rescore            (re-evaluate stored ASR hypotheses with current rules; no new audio)
 *   npx tsx scripts/audio-cli.ts render-batch [--limit 200] [--budget-cap 0] [--ids a,b] [--only-status TECH_QA_PASS] [--force]
 *   npx tsx scripts/audio-cli.ts inspect --audio-id KEG-B2-L01-AUD1
 *   npx tsx scripts/audio-cli.ts export-bundle --out ../audio_bundle     (current files + manifest with SHA-256)
 *   npx tsx scripts/audio-cli.ts import-bundle --dir ../audio_bundle     (fresh machine: verify bytes, upload, register)
 *   npx tsx scripts/audio-cli.ts report --out ../reports
 *   npx tsx scripts/audio-cli.ts benchmark --out reports/v5.4 [--speeds normal,slow,fast]   # every available voice
 *
 * Env: .env.local is read automatically when present (server credentials stay local).
 * Voices come from the casting registry (voice_catalog + cast_roles + audio_job_casting); a job
 * without explicit casting or a matching voice is BLOCKED, never rendered with a random voice.
 * Output is synthesized speech; HUMAN_* statuses are never written.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
}
loadEnvFile(resolve('.env.local'));

const { adminClient, selectAll } = await import('../src/lib/supabase/admin.ts');
const { planJob, renderJob, loadCastingContext, rescoreAsset } = await import('../src/lib/audio/pipeline.ts');
const { syncLocalVoices, syncCloudVoices, proposeCastVoices, proposeJobCasting } = await import('../src/lib/voice/catalog.ts');
const { analyzeWav } = await import('../src/lib/audio/wav.ts');
const { contentHash } = await import('../src/lib/content/stable-json.ts');
const { normalizeAudioJob } = await import('../src/lib/admin/audio.ts');

type Job = { audio_id: string; script_hash: string; text_el: string | null; segments: Array<{ segment_id: string; speaker_role?: string; text_el: string; measured_start_ms?: number | null; measured_end_ms?: number | null }>; payload: Record<string, unknown>; current_hash: string };

const [cmd, ...rest] = process.argv.slice(2);
const arg = (k: string) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : undefined; };
const ids = (arg('--ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const db = adminClient();

async function loadJobs(filter?: string[]): Promise<Job[]> {
  const all = await selectAll<Job>((f, t) => db.from('audio_jobs').select('audio_id, script_hash, text_el, segments, payload, current_hash').order('audio_id').range(f, t));
  return filter?.length ? all.filter((j) => filter.includes(j.audio_id)) : all;
}

async function validate() {
  const root = resolve(process.env.CORPUS_ROOT ?? '../spec/GreekOS_CLAUDE_UPLOAD_READY');
  const source: Array<Record<string, unknown>> = JSON.parse(readFileSync(join(root, 'HANDOFF_IMPORT/audio_jobs.json'), 'utf8'));
  const jobs = await loadJobs();
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const s of source) {
    const id = String(s.audio_id);
    if (seen.has(id)) problems.push(`${id}: duplicate id`);
    seen.add(id);
    const db = jobs.find((j) => j.audio_id === id);
    if (!db) { problems.push(`${id}: not imported`); continue; }
    if (contentHash(s) !== db.current_hash) problems.push(`${id}: DB job hash differs from HANDOFF_IMPORT (re-import required)`);
    if (s.script_version_hash !== db.script_hash) problems.push(`${id}: script hash mismatch`);
    for (const k of ['source_script_path', 'source_manifest_path'] as const) {
      const p = s[k] as string | undefined;
      const h = s[k === 'source_script_path' ? 'source_script_file_hash' : 'source_manifest_hash'] as string | undefined;
      if (!p) continue;
      const fp = join(root, p);
      if (!existsSync(fp)) problems.push(`${id}: ${k} missing`);
      else if (h && createHash('sha256').update(readFileSync(fp)).digest('hex') !== h) problems.push(`${id}: ${k} hash mismatch`);
    }
    if (String(s.status).startsWith('AUDIO_PENDING')) {
      if (s.actual_duration_ms != null) problems.push(`${id}: pending job has actual_duration_ms`);
      if (s.measured_cues != null && !(Array.isArray(s.measured_cues) && s.measured_cues.length === 0)) problems.push(`${id}: pending job has measured_cues`);
      for (const seg of (s.segments as Array<Record<string, unknown>> | undefined) ?? []) {
        if (seg.measured_start_ms != null || seg.measured_end_ms != null) problems.push(`${id}: pending segment ${seg.segment_id} has measured times`);
      }
    }
  }
  console.log(JSON.stringify({ command: 'validate', jobs: source.length, imported: jobs.length, problems: problems.length, detail: problems.slice(0, 50) }, null, 2));
  process.exitCode = problems.length ? 1 : 0;
}

async function plan() {
  const jobs = await loadJobs(ids);
  if (!jobs.length) throw new Error('no matching --ids');
  const ctx = await loadCastingContext();
  console.log(JSON.stringify({ command: 'plan', plans: jobs.map((j) => ({ audio_id: j.audio_id, ...planJob(normalizeAudioJob(j), ctx) })) }, null, 2));
}

async function cast() {
  const local = await syncLocalVoices();
  const cloud = await syncCloudVoices();
  const proposed = await proposeCastVoices();
  const rows = await proposeJobCasting();
  console.log(JSON.stringify({ command: 'cast', local_voices: local, cloud, proposed_cast_voices: proposed, job_casting_rows_written: rows, note: 'Proposals are unapproved; owner approval happens in Admin → Голоса и кастинг.' }, null, 2));
}

async function renderBatch() {
  const limit = Number(arg('--limit') ?? '500');
  const cap = Number(arg('--budget-cap') ?? '0');
  const ctx = await loadCastingContext();
  // --ids a,b and/or --only-status S narrow the batch; --force re-renders (new asset, old one superseded).
  const ids = arg('--ids')?.split(',').map((x) => x.trim()).filter(Boolean);
  const onlyStatus = arg('--only-status');
  const force = rest.includes('--force');
  const statusOf = onlyStatus ? new Map(((await db.from('audio_job_render_status').select('audio_id, status')).data ?? []).map((r) => [r.audio_id, r.status])) : null;
  const jobs = (await loadJobs()).map(normalizeAudioJob).filter((j) => (!ids || ids.includes(j.audio_id)) && (!statusOf || statusOf.get(j.audio_id) === onlyStatus));
  const out: Array<Record<string, unknown>> = [];
  let rendered = 0;
  for (const j of jobs) {
    const p = planJob(j, ctx);
    if (!p.ok) {
      await db.from('audio_job_render_status').upsert({ audio_id: j.audio_id, status: p.status, reason: p.reason, updated_at: new Date().toISOString() });
      out.push({ audio_id: j.audio_id, status: p.status, reason: p.reason });
      continue;
    }
    if (rendered >= limit) { out.push({ audio_id: j.audio_id, status: 'AUDIO_PENDING', reason: 'limit reached' }); continue; }
    const t0 = Date.now();
    const r = await renderJob(j, { actorId: null, budgetCapUsd: cap, ctx, force });
    rendered += r.status === 'RENDERED' ? 1 : 0;
    out.push({ audio_id: j.audio_id, status: r.job_status, render_status: r.render_status ?? null, ms: Date.now() - t0, error: r.error ?? null, roundtrip: r.roundtrip ? { wer: r.roundtrip.wer, cer: r.roundtrip.cer_accent_insensitive, accent: r.roundtrip.accent_mismatches.length } : null });
    console.error(`${j.audio_id}: ${r.job_status} ${r.render_status ?? ''} ${r.error ?? ''} (${Date.now() - t0} ms)`);
  }
  await db.from('admin_audit_log').insert({ actor_id: null, action: 'audio.render_batch_cli', meta: { rendered, total: jobs.length } });
  const counts: Record<string, number> = {};
  for (const o of out) counts[String(o.status)] = (counts[String(o.status)] ?? 0) + 1;
  console.log(JSON.stringify({ command: 'render-batch', total: jobs.length, rendered, counts, jobs: out }, null, 2));
}

async function rescore() {
  const { data: assets } = await db.from('audio_assets').select('id').is('invalidated_at', null).eq('technical_status', 'TECHNICAL_PASS');
  const out = [];
  for (const a of assets ?? []) { const r = await rescoreAsset(a.id); if (r) out.push(r); }
  const changed = out.filter((r) => r.changed);
  console.log(JSON.stringify({ command: 'rescore', checked: out.length, changed: changed.length, verified: out.filter((r) => r.after === 'AUDIO_VERIFIED_DIGITAL').length, detail: changed }, null, 2));
}

/** Columns that describe an asset independently of this database (ids and actors are not exported). */
const BUNDLE_COLUMNS = 'id, audio_id, script_hash, provider, model, voice_map, locale, mime_type, sha256, byte_length, duration_ms, sample_rate, channels, segment_cues, technical_status, technical_report, asr_roundtrip, digital_status, rights_status, rights_evidence, synthetic_disclosure, render_status, synthesis_version, voice_ids, cast_snapshot, generation_params, normalization, cast_approved, object_path, created_at';

async function exportBundle() {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const out = resolve(arg('--out') ?? '../audio_bundle');
  const jobs = (await loadJobs()).map(normalizeAudioJob);
  const [{ data: assets }, { data: statuses }] = await Promise.all([
    db.from('audio_assets').select(BUNDLE_COLUMNS).is('invalidated_at', null),
    db.from('audio_job_render_status').select('audio_id, status, reason'),
  ]);
  const entries: Array<Record<string, unknown>> = [];
  let bytes = 0;
  for (const j of jobs) {
    const a = (assets ?? []).find((x) => x.audio_id === j.audio_id && x.script_hash === j.script_hash);
    const st = (statuses ?? []).find((x) => x.audio_id === j.audio_id);
    if (!a) { entries.push({ audio_id: j.audio_id, script_hash: j.script_hash, file: null, status: st?.status ?? 'AUDIO_PENDING', reason: st?.reason ?? 'not rendered' }); continue; }
    const { data: blob, error } = await db.storage.from('course-audio').download(a.object_path as string);
    if (error || !blob) throw new Error(`${j.audio_id}: ${error?.message ?? 'download failed'}`);
    const buf = Buffer.from(await blob.arrayBuffer());
    if (createHash('sha256').update(buf).digest('hex') !== a.sha256) throw new Error(`${j.audio_id}: stored bytes do not match sha256`);
    const file = `files/${j.audio_id}/${a.sha256}.wav`;
    mkdirSync(join(out, 'files', j.audio_id), { recursive: true });
    writeFileSync(join(out, file), buf);
    bytes += buf.byteLength;
    const { id: _id, object_path: _p, ...meta } = a as Record<string, unknown>;
    entries.push({ audio_id: j.audio_id, file, status: st?.status ?? null, ...meta });
  }
  const manifest = {
    format: 'greekos-audio-bundle/1', exported_at: new Date().toISOString(), jobs: jobs.length, files: entries.filter((e) => e.file).length, bytes,
    note: 'Synthesized el-GR speech for local development. HUMAN_* statuses are never set. DEV_LOCAL_ONLY files must not be distributed to learners.',
    counts: entries.reduce<Record<string, number>>((c, e) => { const k = e.file ? String(e.digital_status) : `NO_FILE:${e.status}`; c[k] = (c[k] ?? 0) + 1; return c; }, {}),
    entries,
  };
  writeFileSync(join(out, 'AUDIO_BUNDLE_MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ command: 'export-bundle', out, jobs: jobs.length, files: manifest.files, bytes, counts: manifest.counts }, null, 2));
}

async function importBundle() {
  const dir = resolve(arg('--dir') ?? '../audio_bundle');
  const manifest = JSON.parse(readFileSync(join(dir, 'AUDIO_BUNDLE_MANIFEST.json'), 'utf8')) as { entries: Array<Record<string, unknown> & { audio_id: string; file: string | null; sha256?: string; script_hash: string }> };
  const jobs = new Map((await loadJobs()).map((j) => [j.audio_id, j]));
  const res = { imported: 0, present: 0, skipped_stale_script: [] as string[], no_file: 0 };
  for (const e of manifest.entries) {
    if (!e.file) { res.no_file++; continue; }
    const job = jobs.get(e.audio_id);
    if (!job || job.script_hash !== e.script_hash) { res.skipped_stale_script.push(e.audio_id); continue; }
    const buf = readFileSync(join(dir, e.file));
    if (createHash('sha256').update(buf).digest('hex') !== e.sha256) throw new Error(`${e.audio_id}: file bytes do not match the manifest sha256`);
    const key = `bundle:${e.sha256}`;
    const { data: existing } = await db.from('audio_assets').select('id').eq('idempotency_key', key).maybeSingle();
    if (existing) { res.present++; continue; }
    const path = `${e.audio_id}/${e.sha256}.wav`;
    const up = await db.storage.from('course-audio').upload(path, buf, { contentType: 'audio/wav', upsert: true });
    if (up.error) throw new Error(`${e.audio_id}: ${up.error.message}`);
    const { file: _f, status: _s, created_at: _c, ...row } = e;
    await db.from('audio_assets').update({ invalidated_at: new Date().toISOString(), invalidated_reason: 'SUPERSEDED_BY_BUNDLE_IMPORT' }).eq('audio_id', e.audio_id).is('invalidated_at', null);
    const { error } = await db.from('audio_assets').insert({ ...row, idempotency_key: key, object_path: path, history: [{ at: new Date().toISOString(), event: 'imported_from_bundle', manifest_created_at: _c }] });
    if (error) throw new Error(`${e.audio_id}: ${error.message}`);
    await db.from('audio_job_render_status').upsert({ audio_id: e.audio_id, status: e.digital_status === 'AUDIO_VERIFIED_DIGITAL' ? 'DIGITAL_REVIEWED' : 'TECH_QA_PASS', reason: 'imported from audio bundle', updated_at: new Date().toISOString() });
    res.imported++;
  }
  console.log(JSON.stringify({ command: 'import-bundle', dir, ...res }, null, 2));
}

async function report() {
  const outDir = resolve(arg('--out') ?? '../reports');
  const { mkdirSync, writeFileSync } = await import('node:fs');
  mkdirSync(outDir, { recursive: true });
  const ctx = await loadCastingContext();
  const jobs = (await loadJobs()).map(normalizeAudioJob);
  const [{ data: statuses }, { data: assets }, { data: casting }] = await Promise.all([
    db.from('audio_job_render_status').select('*'),
    db.from('audio_assets').select('id, audio_id, render_status, digital_status, technical_status, rights_status, cast_approved, voice_ids, duration_ms, sha256, object_path, master_sha256, segment_cues, asr_roundtrip, normalization, created_at, invalidated_at').is('invalidated_at', null),
    db.from('audio_job_casting').select('*'),
  ]);
  const st = new Map((statuses ?? []).map((s) => [s.audio_id, s]));
  const items = jobs.map((j) => {
    const s = st.get(j.audio_id);
    const a = (assets ?? []).find((x) => x.audio_id === j.audio_id);
    const plan = planJob(j, ctx);
    return {
      audio_id: j.audio_id, status: s?.status ?? 'AUDIO_PENDING', reason: s?.reason ?? null,
      casting: (casting ?? []).filter((c) => c.audio_id === j.audio_id).map((c) => ({ role: c.speaker_role, cast_role_id: c.cast_role_id, source: c.source, approved: c.approved, evidence: c.evidence })),
      plan_ok: plan.ok, plan_block: plan.ok ? null : plan.status,
      asset: a ? { asset_id: a.id, render_status: a.render_status, digital_status: a.digital_status, rights_status: a.rights_status, cast_approved: a.cast_approved, voices: a.voice_ids, duration_ms: a.duration_ms, sha256: a.sha256, master_sha256: a.master_sha256, storage: `course-audio/${a.object_path}`, cues: (a.segment_cues as unknown[] | null)?.length ?? 0, roundtrip: a.asr_roundtrip, normalization: a.normalization } : null,
    };
  });
  const count = (f: (i: (typeof items)[number]) => boolean) => items.filter(f).length;
  const rep = {
    generated_at: new Date().toISOString(), scope: 'LOCAL DEVELOPMENT ENVIRONMENT', total_jobs: items.length,
    summary: {
      rendered: count((i) => !!i.asset), qa_pass: count((i) => i.asset?.render_status === 'DIGITAL_REVIEWED' || i.asset?.render_status === 'RELEASE_ELIGIBLE'),
      qa_fail: count((i) => i.asset?.render_status === 'TECH_QA_FAIL'), needs_linguistic_review: count((i) => i.asset?.render_status === 'LINGUISTIC_QA_PENDING'),
      release_eligible: count((i) => i.asset?.render_status === 'RELEASE_ELIGIBLE'), gated: items.length - count((i) => i.asset?.render_status === 'RELEASE_ELIGIBLE'),
      missing_voice_metadata: count((i) => i.status === 'BLOCKED_MISSING_VOICE_METADATA'), no_suitable_voice: count((i) => i.status === 'BLOCKED_NO_SUITABLE_VOICE'),
      pending: count((i) => i.status === 'AUDIO_PENDING'), cost_usd: 0,
    },
    notes: [
      'Local renders use macOS System Voice(s): real synthesized Greek speech for development; rights DEV_LOCAL_ONLY (not distributable to learners).',
      'ASR round-trip uses local faster-whisper medium: a screening signal, not proof of pronunciation.',
      'No job is silently skipped: every job has a status and reason. Casting proposals are unapproved until the owner approves them.',
    ],
    jobs: items,
  };
  writeFileSync(join(outDir, 'AUDIO_RENDER_REPORT.json'), JSON.stringify(rep, null, 2) + '\n');
  const { data: voices } = await db.from('voice_catalog').select('*').order('voice_id');
  const { data: roles } = await db.from('cast_roles').select('*').order('cast_role_id');
  writeFileSync(join(outDir, 'VOICE_CATALOG.json'), JSON.stringify({ generated_at: new Date().toISOString(), voices, cast_roles: roles }, null, 2) + '\n');
  console.log(JSON.stringify({ command: 'report', out: outDir, summary: rep.summary }, null, 2));
}

async function render() {
  const approved = arg('--approved-plan-hash');
  const cap = Number(arg('--budget-cap') ?? '-1');
  if (!approved || !(cap >= 0)) throw new Error('--approved-plan-hash and --budget-cap are required');
  if (ids.length !== 1) throw new Error('render exactly one --ids job per approved plan');
  const [job] = await loadJobs(ids);
  if (!job) throw new Error('job not found');
  const result = await renderJob(normalizeAudioJob(job), { actorId: null, budgetCapUsd: cap, approvedPlanHash: approved });
  await db.from('admin_audit_log').insert({ actor_id: null, action: 'audio.render_cli', target_id: job.audio_id, meta: { status: result.status, render_status: result.render_status ?? null, error: result.error ?? null } });
  console.log(JSON.stringify({ command: 'render', audio_id: job.audio_id, ...result }, null, 2));
  process.exitCode = result.status === 'FAILED' ? 1 : 0;
}

async function inspect() {
  const id = arg('--audio-id');
  if (!id) throw new Error('--audio-id required');
  const { data: a } = await db.from('audio_assets').select('id, object_path, sha256, digital_status, technical_status, rights_status, invalidated_at').eq('audio_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!a?.object_path) { console.log(JSON.stringify({ command: 'inspect', audio_id: id, status: 'NO_ASSET' })); return; }
  const { data, error } = await db.storage.from('course-audio').download(a.object_path);
  if (error || !data) throw new Error(`download failed: ${error?.message}`);
  const bytes = new Uint8Array(await data.arrayBuffer());
  const sha = createHash('sha256').update(bytes).digest('hex');
  console.log(JSON.stringify({ command: 'inspect', audio_id: id, asset_id: a.id, sha256_matches: sha === a.sha256, technical: analyzeWav(bytes), stored: { technical_status: a.technical_status, digital_status: a.digital_status, rights_status: a.rights_status, invalidated: !!a.invalidated_at }, note: 'TECHNICAL_ONLY: no linguistic or pronunciation verdict' }, null, 2));
}

/** Voice benchmark: 30 phrases × available voices × speeds; real synthesis + local ASR round-trip. */
async function benchmark() {
  const { runTtsBenchmark } = await import('../src/lib/voice/benchmark.ts');
  const { syncCloudVoices } = await import('../src/lib/voice/catalog.ts');
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const outDir = resolve(arg('--out') ?? 'reports/v5.4');
  const speeds = (arg('--speeds') ?? 'normal,slow,fast').split(',').filter((x): x is 'normal' | 'slow' | 'fast' => ['normal', 'slow', 'fast'].includes(x));
  const cloud = await syncCloudVoices();
  const r = await runTtsBenchmark({ speeds });
  mkdirSync(outDir, { recursive: true });
  const out = { ...r, cloud_providers: Object.fromEntries(Object.entries(cloud).map(([k, v]) => [k, v === 'NOT_CONFIGURED' ? 'NOT_TESTED (BLOCKED_EXTERNAL: no credentials by owner decision)' : v])) };
  writeFileSync(join(outDir, 'VOICE_PROVIDER_BENCHMARK.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ command: 'benchmark', out: outDir, summary: r.summary, cloud_providers: out.cloud_providers }, null, 2));
}

const commands: Record<string, () => Promise<void>> = { validate, cast, plan, render, 'render-batch': renderBatch, rescore, 'export-bundle': exportBundle, 'import-bundle': importBundle, inspect, report, benchmark };
if (!cmd || !commands[cmd]) {
  console.error('usage: audio-cli.ts validate | cast | plan --ids a,b | render --ids a --approved-plan-hash H --budget-cap N | render-batch [--limit N] [--budget-cap N] | inspect --audio-id a | report --out DIR | benchmark [--out DIR] [--speeds normal,slow,fast]');
  process.exit(2);
}
try {
  await commands[cmd]();
} catch (e) {
  console.error(`audio-cli ${cmd} failed:`, (e as Error).message);
  process.exitCode = 1;
}
