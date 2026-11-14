import { z } from 'zod';
import { route, jsonBody } from '@/lib/api';
import { apiOwner, audit, HttpError } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { editorialAudioRelease } from '@/lib/qa/editorial';

const Body = z.object({
  // One file, or every current file synthesised by this provider (the owner records the terms once).
  asset_id: z.string().uuid().optional(),
  all_by_provider: z.enum(['azure']).optional(),
  provider: z.string().trim().min(2).max(80),
  terms_url: z.string().url().max(500),
  checked_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  scope_ru: z.string().trim().min(5).max(500),
}).strict();

/**
 * Records the provider's usage terms the owner reviewed — the owner's own act, never delegated. For one
 * file, or (`all_by_provider`) for every current file synthesised by that provider. Afterwards, under a
 * policy that delegates it, the AI editor releases the files that have no other blocker.
 */
export const maxDuration = 120;

export const POST = route(async (req) => {
  const owner = await apiOwner();
  const b = Body.parse(await jsonBody(req));
  if (!b.asset_id && !b.all_by_provider) throw new HttpError(400, 'INVALID_REQUEST', 'Укажите файл или провайдера.');
  const db = adminClient();
  const q = db.from('audio_assets').select('id, provider, invalidated_at, rights_status, voice_ids, cast_approved, digital_status').is('invalidated_at', null);
  const { data: rows } = b.asset_id ? await q.eq('id', b.asset_id) : await q.eq('provider', b.all_by_provider!);
  if (!rows?.length) throw new HttpError(404, 'NOT_FOUND', 'Аудио не найдено');
  const { data: catalog } = await db.from('voice_catalog').select('voice_id, distribution_allowed, provider');
  const voiceOf = new Map((catalog ?? []).map((v) => [v.voice_id, v]));
  let recorded = 0;
  const skipped: string[] = [];
  for (const a of rows) {
    // MBROLA (non-commercial diphones), macOS voices and the test transport never reach learners.
    const bad = a.rights_status === 'DEV_LOCAL_ONLY' || a.provider === 'mock' || ((a.voice_ids as string[]) ?? []).some((id) => { const v = voiceOf.get(id); return !v || ['local_macos', 'local_mbrola', 'mock'].includes(v.provider) || v.distribution_allowed === false; });
    if (bad) {
      if (b.asset_id) throw new HttpError(409, 'NOT_DISTRIBUTABLE', 'В файле есть голос, не предназначенный для распространения (MBROLA, голос macOS или тестовый транспорт). Перегенерируйте голосом провайдера с коммерческими правами.');
      skipped.push(a.id);
      continue;
    }
    const evidence = { provider: b.provider, terms_url: b.terms_url, checked_on: b.checked_on, scope_ru: b.scope_ru, recorded_by: owner.userId, recorded_at: new Date().toISOString(), basis: 'OWNER_RECORDED_PROVIDER_TERMS', synthetic_voice: true };
    const eligible = a.cast_approved && a.digital_status === 'AUDIO_VERIFIED_DIGITAL';
    await db.from('audio_assets').update({ rights_status: 'PROVIDER_TERMS_RECORDED', rights_evidence: evidence, ...(eligible ? { render_status: 'RELEASE_ELIGIBLE' } : {}) }).eq('id', a.id);
    if (eligible) await db.from('audio_job_render_status').update({ status: 'RELEASE_ELIGIBLE', updated_at: new Date().toISOString() }).eq('last_asset_id', a.id);
    recorded += 1;
  }
  await audit(owner.userId, 'audio.rights_recorded', { id: b.asset_id ?? `provider:${b.all_by_provider}` }, { provider: b.provider, terms_url: b.terms_url, checked_on: b.checked_on, recorded, skipped: skipped.length });
  const editorial = await editorialAudioRelease().catch((e: Error) => ({ status: 'pending' as const, reason: e.message }));
  return { ok: true, recorded, skipped: skipped.length, editorial };
});
