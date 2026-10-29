/**
 * Digital-only audio production for the AUDIO_EXECUTION_PACK queue (v5.4 §7).
 * casting → plan → synthesize per segment with the CAST voice → join with measured gaps →
 * loudness normalisation (master kept) → technical QA → ASR round-trip → lifecycle status.
 * Never writes HUMAN_* statuses; publication still needs approved casting, rights and a release.
 */
import { createHash } from 'node:crypto';
import { adminClient } from '../supabase/admin.ts';
import { env } from '../env.ts';
import { stableStringify } from '../content/stable-json.ts';
import { synthesizeWithVoice, transcribe, asrStatus } from '../providers/speech.ts';
import { localAsrHealth, localTranscribe } from '../providers/local-engines.ts';
import { COST } from '../providers/budget.ts';
import { analyzeWav, concatWav, normalizeLoudness, parseWav, pcmSamples, type TechnicalReport } from './wav.ts';
import { alignmentDiff, chunkText, roundTrip, roundTripPass, segmentSignals, type RoundTripMetrics } from './roundtrip.ts';
import type { CatalogVoice, CastRole } from '../voice/catalog.ts';

export const SYNTHESIS_VERSION = 'greekos-audio/2.0';

export interface AudioJobRow {
  audio_id: string;
  script_hash: string;
  text_el: string | null;
  segments: unknown;
  payload: Record<string, unknown>;
}

type RawSegment = { segment_id?: string; cue_id?: string; speaker_role?: string; speaker?: string; text_el?: string; text?: string };

/** Canonical jobs use two segment shapes (course: segment_id/speaker_role/text_el; exam L01–L03: cue_id/speaker/text). */
export function normalizeSegments(audioId: string, segments: unknown): Array<{ id: string; role: string | null; text: string }> {
  const raw = Array.isArray(segments) ? (segments as RawSegment[]) : [];
  return raw
    .map((s, i) => ({ id: s.segment_id ?? s.cue_id ?? `${audioId}-S${String(i + 1).padStart(2, '0')}`, role: s.speaker_role ?? s.speaker ?? null, text: s.text_el ?? s.text ?? '' }))
    .filter((s) => s.text.trim().length > 0);
}

export interface PlannedSegment {
  segment_id: string;
  role: string;
  cast_role_id: string;
  voice_id: string;
  text: string;
  gap_before_ms: number;
}

export interface AudioPlan {
  audio_id: string;
  script_hash: string;
  voice_map: Record<string, string>;
  cast_map: Record<string, string>;
  segments: PlannedSegment[];
  characters: number;
  estimated_cost_usd: number;
  cast_approved: boolean;
  engines: string[];
  idempotency_key: string;
  plan_hash: string;
}

export type PlanResult =
  | { ok: true; plan: AudioPlan }
  | { ok: false; status: 'BLOCKED_MISSING_VOICE_METADATA' | 'BLOCKED_NO_SUITABLE_VOICE'; reason: string };

export interface CastingRow { audio_id: string; speaker_role: string; cast_role_id: string | null; required_presentation: string | null; source: string; approved: boolean }

export interface CastingContext {
  casting: Map<string, CastingRow>; // key `${audio_id}|${speaker_role}`
  castRoles: Map<string, CastRole>;
  voices: Map<string, CatalogVoice>;
}

const ROLE_GAP_MS = 650;
const CHUNK_GAP_MS = 350;

/**
 * Builds a plan only when every speaker has an explicit cast role and a usable voice whose declared
 * presentation matches; distinct speakers must have distinct voices. Otherwise the job is BLOCKED
 * with a reason — never rendered with a random or wrong voice.
 */
export function planJob(job: AudioJobRow, ctx: CastingContext): PlanResult {
  const norm = normalizeSegments(job.audio_id, job.segments);
  const src = norm.length ? norm.map((s) => ({ ...s, role: s.role ?? '__narrator__' })) : [{ id: `${job.audio_id}-S01`, role: '__narrator__', text: job.text_el ?? '' }];
  const roles = [...new Set(src.map((s) => s.role))];
  const castMap: Record<string, string> = {};
  const voiceMap: Record<string, string> = {};
  let castApproved = true;
  for (const role of roles) {
    const c = ctx.casting.get(`${job.audio_id}|${role}`);
    if (!c || !c.cast_role_id) return { ok: false, status: 'BLOCKED_MISSING_VOICE_METADATA', reason: `роль «${role}» без назначенного голоса (нужен кастинг владельцем)` };
    const cr = ctx.castRoles.get(c.cast_role_id);
    if (!cr?.voice_id) return { ok: false, status: 'BLOCKED_NO_SUITABLE_VOICE', reason: `для ${c.cast_role_id} (${c.required_presentation ?? cr?.requested_presentation}) нет голоса в каталоге` };
    const v = ctx.voices.get(cr.voice_id);
    if (!v || !v.available) return { ok: false, status: 'BLOCKED_NO_SUITABLE_VOICE', reason: `голос ${cr.voice_id} недоступен` };
    const need = c.required_presentation && c.required_presentation !== 'any' ? c.required_presentation : cr.requested_presentation === 'any' ? null : cr.requested_presentation;
    if (need && v.presentation !== need) return { ok: false, status: 'BLOCKED_NO_SUITABLE_VOICE', reason: `роль «${role}» требует ${need === 'male' ? 'мужской' : 'женский'} голос, а у ${v.display_name} заявлен ${v.presentation}` };
    castMap[role] = c.cast_role_id;
    voiceMap[role] = v.voice_id;
    castApproved &&= c.approved && cr.approved && v.approved_by_owner;
  }
  const distinctVoices = new Set(Object.values(voiceMap));
  if (distinctVoices.size < roles.length) {
    return { ok: false, status: 'BLOCKED_NO_SUITABLE_VOICE', reason: `${roles.length} персонажа(ей), но различимых голосов только ${distinctVoices.size}: один голос на разных персонажей не допускается` };
  }
  const segments: PlannedSegment[] = [];
  let prevRole: string | null = null;
  for (const s of src) {
    chunkText(s.text).forEach((chunk, i) => {
      segments.push({ segment_id: i ? `${s.id}#${i + 1}` : s.id, role: s.role, cast_role_id: castMap[s.role], voice_id: voiceMap[s.role], text: chunk, gap_before_ms: segments.length === 0 ? 0 : prevRole !== s.role || i === 0 ? ROLE_GAP_MS : CHUNK_GAP_MS });
    });
    prevRole = s.role;
  }
  const characters = segments.reduce((a, s) => a + s.text.length, 0);
  const engines = [...new Set([...distinctVoices].map((id) => ctx.voices.get(id)!.provider))];
  const cloudChars = segments.filter((s) => ctx.voices.get(s.voice_id)?.engine_kind === 'cloud').reduce((a, s) => a + s.text.length, 0);
  const settings = { version: SYNTHESIS_VERSION, voiceMap, gaps: [ROLE_GAP_MS, CHUNK_GAP_MS], format: 'wav-pcm16-24k', normalization: 'rms-20dbfs-peak-1dbfs' };
  const idempotency_key = createHash('sha256').update(stableStringify({ settings, script_hash: job.script_hash, segments: segments.map((s) => [s.segment_id, s.voice_id, s.text]) })).digest('hex');
  const plan = { audio_id: job.audio_id, script_hash: job.script_hash, voice_map: voiceMap, cast_map: castMap, segments, characters, estimated_cost_usd: Number((cloudChars * COST.ttsPerChar).toFixed(4)), cast_approved: castApproved, engines, idempotency_key };
  return { ok: true, plan: { ...plan, plan_hash: createHash('sha256').update(stableStringify(plan)).digest('hex') } };
}

export async function loadCastingContext(): Promise<CastingContext> {
  const db = adminClient();
  const [{ data: casting }, { data: roles }, { data: voices }] = await Promise.all([
    db.from('audio_job_casting').select('audio_id, speaker_role, cast_role_id, required_presentation, source, approved'),
    db.from('cast_roles').select('cast_role_id, requested_presentation, voice_id, approved, use_case'),
    db.from('voice_catalog').select('*'),
  ]);
  return {
    casting: new Map(((casting ?? []) as CastingRow[]).map((c) => [`${c.audio_id}|${c.speaker_role}`, c])),
    castRoles: new Map(((roles ?? []) as CastRole[]).map((r) => [r.cast_role_id, r])),
    voices: new Map(((voices ?? []) as CatalogVoice[]).map((v) => [v.voice_id, v])),
  };
}

export interface RenderResult {
  status: 'REUSED' | 'RENDERED' | 'BLOCKED' | 'FAILED';
  job_status: string;
  asset_id?: string;
  render_status?: string;
  technical?: TechnicalReport | null;
  roundtrip?: (RoundTripMetrics & { engine: string }) | null;
  error?: string;
}

async function setJobStatus(audioId: string, status: string, reason: string | null, extra: { attempted?: boolean; asset_id?: string; cost?: number } = {}) {
  const db = adminClient();
  const { data: prev } = await db.from('audio_job_render_status').select('attempts').eq('audio_id', audioId).maybeSingle();
  await db.from('audio_job_render_status').upsert({
    audio_id: audioId, status, reason, attempts: (prev?.attempts ?? 0) + (extra.attempted ? 1 : 0), updated_at: new Date().toISOString(),
    ...(extra.asset_id ? { last_asset_id: extra.asset_id } : {}), ...(extra.cost !== undefined ? { estimated_cost_usd: extra.cost } : {}),
  });
}

/** ASR round-trip: local Whisper medium when the local service is up, else the configured cloud ASR. */
async function roundTripFor(rendered: Uint8Array[], texts: string[], actorId: string | null): Promise<(RoundTripMetrics & { engine: string; diff: ReturnType<typeof alignmentDiff> }) | null> {
  const local = env.localEnginesAllowed ? await localAsrHealth() : null;
  const hyps: string[] = [];
  let engine = '';
  try {
    if (local?.available.includes('medium')) {
      for (const b of rendered) hyps.push((await localTranscribe(b, 'medium', 300_000)).text);
      engine = 'local:faster-whisper-medium-int8';
    } else if (asrStatus().configured && !asrStatus().synthetic && asrStatus().provider !== 'local') {
      for (const b of rendered) hyps.push((await transcribe(b, actorId)).text);
      engine = `cloud:${asrStatus().provider}`;
    } else return null;
  } catch {
    return null;
  }
  return { ...roundTrip(texts.join(' '), hyps.join(' ')), engine, diff: alignmentDiff(texts.join(' '), hyps.join(' ')) };
}

export async function renderJob(job: AudioJobRow, opts: { actorId: string | null; budgetCapUsd?: number; approvedPlanHash?: string; ctx?: CastingContext; force?: boolean }): Promise<RenderResult> {
  const db = adminClient();
  const ctx = opts.ctx ?? (await loadCastingContext());
  const planned = planJob(job, ctx);
  if (!planned.ok) {
    await setJobStatus(job.audio_id, planned.status, planned.reason);
    return { status: 'BLOCKED', job_status: planned.status, error: planned.reason };
  }
  const plan = planned.plan;
  if (opts.approvedPlanHash && opts.approvedPlanHash !== plan.plan_hash) return { status: 'FAILED', job_status: 'RENDER_FAILED', error: 'PLAN_HASH_MISMATCH' };
  if (plan.estimated_cost_usd > (opts.budgetCapUsd ?? env.audioRunBudgetUsd)) {
    await setJobStatus(job.audio_id, 'BLOCKED_BUDGET', `оценка ${plan.estimated_cost_usd}$ выше лимита`);
    return { status: 'BLOCKED', job_status: 'BLOCKED_BUDGET', error: 'BUDGET_CAP' };
  }
  const { data: existing } = await db.from('audio_assets').select('id, render_status, invalidated_at').eq('idempotency_key', plan.idempotency_key).maybeSingle();
  if (existing && !existing.invalidated_at && !opts.force) return { status: 'REUSED', job_status: existing.render_status, asset_id: existing.id, render_status: existing.render_status };

  const rendered: Uint8Array[] = [];
  for (const seg of plan.segments) {
    const voice = ctx.voices.get(seg.voice_id)!;
    let attempt = 0;
    for (;;) {
      try {
        rendered.push((await synthesizeWithVoice(seg.text, voice, { speed: 'normal', userId: opts.actorId, operation: 'tts_course_audio' })).bytes);
        break;
      } catch (e) {
        attempt += 1;
        if (attempt > 3) {
          await setJobStatus(job.audio_id, 'RENDER_FAILED', `${seg.segment_id}: ${(e as Error).message}`, { attempted: true });
          return { status: 'FAILED', job_status: 'RENDER_FAILED', error: `SEGMENT_FAILED ${seg.segment_id}: ${(e as Error).message}` };
        }
        await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
      }
    }
  }
  // Master keeps the raw synthesis; delivery is loudness-normalised (single gain, no compression).
  const master = concatWav(rendered, plan.segments.map((s) => s.gap_before_ms));
  const norm = normalizeLoudness(master.wav);
  const tech = analyzeWav(norm.wav, { allowedPauseMs: ROLE_GAP_MS + 2000 });
  const sha = createHash('sha256').update(norm.wav).digest('hex');
  const masterSha = createHash('sha256').update(master.wav).digest('hex');
  const deliveryPath = `${job.audio_id}/${sha}.wav`;
  const masterPath = `${job.audio_id}/master/${masterSha}.wav`;
  for (const [path, bytes] of [[deliveryPath, norm.wav], [masterPath, master.wav]] as const) {
    const up = await db.storage.from('course-audio').upload(path, bytes, { contentType: 'audio/wav', upsert: true });
    if (up.error) {
      await setJobStatus(job.audio_id, 'RENDER_FAILED', `upload: ${up.error.message}`, { attempted: true });
      return { status: 'FAILED', job_status: 'RENDER_FAILED', error: `UPLOAD ${up.error.message}` };
    }
  }
  const rt = tech?.pass ? await roundTripFor(rendered, plan.segments.map((s) => s.text), opts.actorId) : null;
  const signals = segmentSignals(plan.segments.map((s) => s.text), rendered, (b) => { const i = parseWav(b); return i ? { samples: pcmSamples(b, i), rate: i.sampleRate } : null; });
  const truncated = signals.filter((x) => x.truncated_end).map((x) => x.segment);
  const technicalPass = !!tech?.pass;
  // A possibly cut-off segment always goes to a reviewer, even when the round-trip looks fine.
  const rtPass = !!rt && roundTripPass(rt) && !truncated.length;
  const renderStatus = !technicalPass ? 'TECH_QA_FAIL' : rtPass ? 'DIGITAL_REVIEWED' : 'LINGUISTIC_QA_PENDING';
  const voices = [...new Set(plan.segments.map((s) => s.voice_id))].map((id) => ctx.voices.get(id)!);
  const devOnly = voices.some((v) => !v.distribution_allowed);
  const cues = plan.segments.map((s, i) => ({ segment_id: s.segment_id, role: s.role, voice_id: s.voice_id, ...master.cues[i] }));
  const { data: prevAssets } = await db.from('audio_assets').select('id').eq('audio_id', job.audio_id).is('invalidated_at', null);
  const { data: inserted, error } = await db.from('audio_assets').insert({
    audio_id: job.audio_id, script_hash: job.script_hash, idempotency_key: opts.force ? `${plan.idempotency_key}:${Date.now()}` : plan.idempotency_key,
    provider: plan.engines.join('+'), model: voices.map((v) => v.provider_voice_name).join('+'), voice_map: plan.voice_map, voice_ids: voices.map((v) => v.voice_id),
    cast_snapshot: plan.cast_map, cast_approved: plan.cast_approved, synthesis_version: SYNTHESIS_VERSION,
    generation_params: { speed: 'normal', gaps_ms: [ROLE_GAP_MS, CHUNK_GAP_MS], sample_rate: tech?.sample_rate ?? null, plan_hash: plan.plan_hash },
    object_path: deliveryPath, mime_type: 'audio/wav', sha256: sha, byte_length: norm.wav.byteLength,
    master_object_path: masterPath, master_sha256: masterSha, normalization: norm.report,
    duration_ms: tech?.duration_ms ?? null, sample_rate: tech?.sample_rate ?? null, channels: tech?.channels ?? null, segment_cues: cues,
    technical_status: technicalPass ? 'TECHNICAL_PASS' : 'TECHNICAL_FAIL', technical_report: tech,
    asr_roundtrip: rt, digital_status: rtPass ? 'AUDIO_VERIFIED_DIGITAL' : technicalPass ? 'NEEDS_REVIEW' : 'BLOCKED',
    rights_status: devOnly ? 'DEV_LOCAL_ONLY' : 'RIGHTS_PENDING', rights_evidence: devOnly ? { voices: voices.filter((v) => !v.distribution_allowed).map((v) => ({ voice_id: v.voice_id, rights: v.rights })) } : null,
    render_status: renderStatus, created_by: opts.actorId,
    history: [{ at: new Date().toISOString(), event: 'rendered', render_status: renderStatus, superseded: (prevAssets ?? []).map((p) => p.id) }],
  }).select('id').single();
  if (error) {
    await setJobStatus(job.audio_id, 'RENDER_FAILED', error.message, { attempted: true });
    return { status: 'FAILED', job_status: 'RENDER_FAILED', error: error.message };
  }
  const stale = (prevAssets ?? []).map((p) => p.id).filter((id) => id !== inserted.id);
  if (stale.length) await db.from('audio_assets').update({ invalidated_at: new Date().toISOString(), invalidated_reason: 'SUPERSEDED_BY_RERENDER' }).in('id', stale);
  await db.from('digital_qa_runs').insert({
    content_kind: 'audio_asset', content_id: inserted.id, content_hash: sha, check_kind: 'DIGITAL_AUDIO_QA', tool_id: `${tech?.profile ?? 'n/a'}+${rt?.engine ?? 'no-asr'}`,
    verdict: renderStatus === 'DIGITAL_REVIEWED' ? 'PASS' : renderStatus === 'TECH_QA_FAIL' ? 'FAIL' : 'NEEDS_REVIEW', report: { technical: tech, roundtrip: rt, signals, plan_hash: plan.plan_hash, normalization: norm.report }, run_by: opts.actorId,
  });
  const jobStatus = renderStatus === 'TECH_QA_FAIL' ? 'TECH_QA_FAIL' : renderStatus === 'DIGITAL_REVIEWED' ? 'DIGITAL_REVIEWED' : 'TECH_QA_PASS';
  await setJobStatus(job.audio_id, jobStatus, renderStatus === 'LINGUISTIC_QA_PENDING' ? (truncated.length ? `возможный обрыв в конце сегментов ${truncated.join(', ')}` : rt ? 'ASR round-trip выше порогов — нужен разбор' : 'ASR round-trip не выполнен') : null, { attempted: true, asset_id: inserted.id, cost: plan.estimated_cost_usd });
  return { status: 'RENDERED', job_status: jobStatus, asset_id: inserted.id, render_status: renderStatus, technical: tech, roundtrip: rt };
}
