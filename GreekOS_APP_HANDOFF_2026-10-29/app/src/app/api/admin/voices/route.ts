import { z } from 'zod';
import { route, jsonBody } from '@/lib/api';
import { apiOwner, audit, HttpError } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { syncLocalVoices, syncCloudVoices, proposeCastVoices, proposeJobCasting, loadCatalog } from '@/lib/voice/catalog';
import { renderVoiceSample } from '@/lib/voice/samples';
import { renderJob, loadCastingContext, planJob } from '@/lib/audio/pipeline';
import { normalizeAudioJob } from '@/lib/admin/audio';

export const maxDuration = 300;

const CAST = z.string().regex(/^[A-Z_]{3,30}$/);
const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('sync') }),
  z.object({ action: z.literal('approve_voice'), voice_id: z.string().max(200), approved: z.boolean() }),
  z.object({ action: z.literal('set_cast_role'), cast_role_id: CAST, voice_id: z.string().max(200).nullable() }),
  z.object({ action: z.literal('approve_cast_role'), cast_role_id: CAST, approved: z.boolean() }),
  z.object({ action: z.literal('set_job_casting'), audio_id: z.string().max(80), speaker_role: z.string().max(80), cast_role_id: CAST.nullable(), approved: z.boolean() }),
  z.object({ action: z.literal('approve_job_casting'), audio_id: z.string().max(80) }),
  z.object({ action: z.literal('sample'), voice_id: z.string().max(200) }),
  z.object({ action: z.literal('render_batch'), limit: z.number().int().min(1).max(5), budget_cap_usd: z.number().min(0).max(100) }),
]);

const DONE = ['TECH_QA_PASS', 'TECH_QA_FAIL', 'DIGITAL_REVIEWED', 'RELEASE_ELIGIBLE'];

export const POST = route(async (req) => {
  const owner = await apiOwner();
  const b = Body.parse(await jsonBody(req));
  const db = adminClient();
  const now = new Date().toISOString();
  switch (b.action) {
    case 'sync': {
      const local = await syncLocalVoices();
      const cloud = await syncCloudVoices();
      const proposedCast = await proposeCastVoices();
      const jobRows = await proposeJobCasting();
      await audit(owner.userId, 'voices.sync', {}, { local: local.length, cloud, proposed_cast: proposedCast.length, job_casting_rows: jobRows });
      return { local_voices: local.length, cloud, proposed_cast: proposedCast, job_casting_rows: jobRows };
    }
    case 'approve_voice': {
      const { data: v } = await db.from('voice_catalog').select('provider, sample_object_path').eq('voice_id', b.voice_id).maybeSingle();
      if (!v) throw new HttpError(404, 'NOT_FOUND', 'Голос не найден');
      if (v.provider === 'mock') throw new HttpError(409, 'MOCK', 'Тестовый транспорт не утверждается как голос');
      if (b.approved && !v.sample_object_path) throw new HttpError(409, 'NO_SAMPLE', 'Сначала прослушайте образец голоса');
      await db.from('voice_catalog').update({ approved_by_owner: b.approved, approved_by: b.approved ? owner.userId : null, approved_at: b.approved ? now : null, qa_status: b.approved ? 'OWNER_LISTENED' : 'TECH_QA_PASS' }).eq('voice_id', b.voice_id);
      await audit(owner.userId, 'voices.approve', { id: b.voice_id }, { approved: b.approved });
      return { ok: true };
    }
    case 'set_cast_role': {
      const { data: role } = await db.from('cast_roles').select('requested_presentation').eq('cast_role_id', b.cast_role_id).maybeSingle();
      if (!role) throw new HttpError(404, 'NOT_FOUND', 'Роль кастинга не найдена');
      if (b.voice_id) {
        const v = (await loadCatalog()).get(b.voice_id);
        if (!v) throw new HttpError(404, 'NOT_FOUND', 'Голос не найден');
        if (role.requested_presentation !== 'any' && v.presentation !== role.requested_presentation) throw new HttpError(422, 'PRESENTATION_MISMATCH', `Роль требует ${role.requested_presentation === 'male' ? 'мужской' : 'женский'} голос по заявлению провайдера; у этого голоса — ${v.presentation}. Подмена высотой тона не допускается.`);
      }
      await db.from('cast_roles').update({ voice_id: b.voice_id, approved: false, approved_by: null, approved_at: null, status: b.voice_id ? 'assigned' : 'unassigned' }).eq('cast_role_id', b.cast_role_id);
      await audit(owner.userId, 'voices.cast_role_set', { id: b.cast_role_id }, { voice_id: b.voice_id });
      return { ok: true };
    }
    case 'approve_cast_role': {
      const { data: role } = await db.from('cast_roles').select('voice_id').eq('cast_role_id', b.cast_role_id).maybeSingle();
      if (b.approved && !role?.voice_id) throw new HttpError(409, 'NO_VOICE', 'Сначала назначьте голос');
      await db.from('cast_roles').update({ approved: b.approved, approved_by: b.approved ? owner.userId : null, approved_at: b.approved ? now : null, status: b.approved ? 'approved' : 'assigned' }).eq('cast_role_id', b.cast_role_id);
      await audit(owner.userId, 'voices.cast_role_approve', { id: b.cast_role_id }, { approved: b.approved });
      return { ok: true };
    }
    case 'set_job_casting': {
      const { data: role } = b.cast_role_id ? await db.from('cast_roles').select('requested_presentation').eq('cast_role_id', b.cast_role_id).maybeSingle() : { data: null };
      await db.from('audio_job_casting').upsert({ audio_id: b.audio_id, speaker_role: b.speaker_role, cast_role_id: b.cast_role_id, required_presentation: role?.requested_presentation ?? null, source: 'owner', evidence: 'назначено владельцем', approved: b.approved && !!b.cast_role_id, approved_by: b.approved ? owner.userId : null, approved_at: b.approved ? now : null, updated_at: now });
      await audit(owner.userId, 'voices.job_casting_set', { id: `${b.audio_id}|${b.speaker_role}` }, { cast_role_id: b.cast_role_id, approved: b.approved });
      return { ok: true };
    }
    case 'approve_job_casting': {
      const { data } = await db.from('audio_job_casting').update({ approved: true, approved_by: owner.userId, approved_at: now }).eq('audio_id', b.audio_id).not('cast_role_id', 'is', null).select('speaker_role');
      await audit(owner.userId, 'voices.job_casting_approve', { id: b.audio_id }, { roles: (data ?? []).length });
      return { approved: (data ?? []).length };
    }
    case 'sample': {
      const v = (await loadCatalog()).get(b.voice_id);
      if (!v) throw new HttpError(404, 'NOT_FOUND', 'Голос не найден');
      const r = await renderVoiceSample(v, owner.userId);
      await audit(owner.userId, 'voices.sample', { id: b.voice_id }, { sha256: r.sha, technical_pass: r.technical?.pass ?? false });
      return { ok: true, technical: r.technical };
    }
    case 'render_batch': {
      const ctx = await loadCastingContext();
      const [{ data: jobs }, { data: statuses }] = await Promise.all([
        db.from('audio_jobs').select('audio_id, script_hash, text_el, segments, payload').order('audio_id'),
        db.from('audio_job_render_status').select('audio_id, status'),
      ]);
      const done = new Map((statuses ?? []).map((s) => [s.audio_id, s.status]));
      const queue = (jobs ?? []).filter((j) => !DONE.includes(done.get(j.audio_id) ?? '')).map(normalizeAudioJob);
      const renderable = queue.filter((j) => planJob(j, ctx).ok);
      const results = [];
      for (const j of renderable.slice(0, b.limit)) {
        const r = await renderJob(j, { actorId: owner.userId, budgetCapUsd: b.budget_cap_usd, ctx });
        results.push({ audio_id: j.audio_id, status: r.status, job_status: r.job_status, render_status: r.render_status ?? null, error: r.error ?? null });
      }
      // Record explicit blocked status for jobs that cannot be planned (never silently skipped).
      for (const j of queue.filter((x) => !renderable.includes(x))) {
        const p = planJob(j, ctx);
        if (!p.ok && done.get(j.audio_id) !== p.status) await db.from('audio_job_render_status').upsert({ audio_id: j.audio_id, status: p.status, reason: p.reason, updated_at: now });
      }
      await audit(owner.userId, 'audio.render_batch', {}, { processed: results.length, remaining: renderable.length - results.length });
      return { processed: results, remaining_renderable: Math.max(0, renderable.length - results.length), blocked: queue.length - renderable.length };
    }
  }
});
