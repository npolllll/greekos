import { z } from 'zod';
import { route, jsonBody } from '@/lib/api';
import { apiOwner, audit, HttpError } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { renderJob } from '@/lib/audio/pipeline';
import { normalizeAudioJob } from '@/lib/admin/audio';

export const maxDuration = 300;
const Body = z.object({ audio_id: z.string().min(1).max(80), approved_plan_hash: z.string().regex(/^[0-9a-f]{64}$/), budget_cap_usd: z.number().positive().max(100) }).strict();

/** Owner-approved digital render of one audio job (plan hash must match what the owner reviewed). */
export const POST = route(async (req) => {
  const owner = await apiOwner();
  const b = Body.parse(await jsonBody(req));
  const { data: job } = await adminClient().from('audio_jobs').select('audio_id, script_hash, text_el, segments, payload').eq('audio_id', b.audio_id).maybeSingle();
  if (!job) throw new HttpError(404, 'NOT_FOUND', 'Задание аудио не найдено');
  const result = await renderJob(normalizeAudioJob(job), { actorId: owner.userId, budgetCapUsd: b.budget_cap_usd, approvedPlanHash: b.approved_plan_hash });
  await audit(owner.userId, 'audio.render', { id: b.audio_id }, { status: result.status, asset_id: result.asset_id ?? null, render_status: result.render_status ?? null, job_status: result.job_status, error: result.error ?? null });
  if (result.status === 'FAILED') throw new HttpError(422, 'RENDER_FAILED', `Генерация не выполнена: ${result.error}`);
  if (result.status === 'BLOCKED') throw new HttpError(409, result.job_status, `Генерация заблокирована: ${result.error}`);
  return result;
});
