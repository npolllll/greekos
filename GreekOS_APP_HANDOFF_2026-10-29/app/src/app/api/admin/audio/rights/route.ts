import { z } from 'zod';
import { route, jsonBody } from '@/lib/api';
import { apiOwner, audit, HttpError } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';

const Body = z.object({
  asset_id: z.string().uuid(),
  provider: z.string().trim().min(2).max(80),
  terms_url: z.string().url().max(500),
  checked_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  scope_ru: z.string().trim().min(5).max(500),
}).strict();

/** Records the provider's usage terms the owner reviewed for this synthesized asset. */
export const POST = route(async (req) => {
  const owner = await apiOwner();
  const b = Body.parse(await jsonBody(req));
  const db = adminClient();
  const { data: a } = await db.from('audio_assets').select('id, provider, invalidated_at, rights_status, voice_ids, cast_approved, digital_status').eq('id', b.asset_id).maybeSingle();
  if (!a) throw new HttpError(404, 'NOT_FOUND', 'Аудио не найдено');
  if (a.invalidated_at) throw new HttpError(409, 'INVALIDATED', 'Аудио устарело');
  if (a.rights_status === 'DEV_LOCAL_ONLY' || a.provider === 'mock') throw new HttpError(409, 'NOT_DISTRIBUTABLE', 'Этот файл сделан локальным голосом разработки (лицензия macOS — только личное некоммерческое использование) или тестовым транспортом. Для выпуска ученикам перегенерируйте голосом провайдера с коммерческими правами.');
  const { data: voices } = await db.from('voice_catalog').select('voice_id, distribution_allowed, provider').in('voice_id', (a.voice_ids as string[]).length ? (a.voice_ids as string[]) : ['-']);
  if ((voices ?? []).some((v) => v.provider === 'local_macos' || v.provider === 'mock')) throw new HttpError(409, 'NOT_DISTRIBUTABLE', 'В файле есть голос, не предназначенный для распространения.');
  const evidence = { provider: b.provider, terms_url: b.terms_url, checked_on: b.checked_on, scope_ru: b.scope_ru, recorded_by: owner.userId, recorded_at: new Date().toISOString(), basis: 'OWNER_RECORDED_PROVIDER_TERMS', synthetic_voice: true };
  const eligible = a.cast_approved && a.digital_status === 'AUDIO_VERIFIED_DIGITAL';
  await db.from('audio_assets').update({ rights_status: 'PROVIDER_TERMS_RECORDED', rights_evidence: evidence, ...(eligible ? { render_status: 'RELEASE_ELIGIBLE' } : {}) }).eq('id', b.asset_id);
  if (eligible) await db.from('audio_job_render_status').update({ status: 'RELEASE_ELIGIBLE', updated_at: new Date().toISOString() }).eq('last_asset_id', b.asset_id);
  await audit(owner.userId, 'audio.rights_recorded', { id: b.asset_id }, { provider: b.provider, terms_url: b.terms_url, checked_on: b.checked_on });
  return { ok: true };
});
