import { z } from 'zod';
import { route, jsonBody } from '@/lib/api';
import { apiUser, audit, HttpError } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';

const Grant = z.object({
  action: z.literal('grant'),
  purpose: z.enum(['voice_review_retention', 'owner_transcript_access']),
  artifact_id: z.string().max(80).nullable().optional(),
  days: z.number().int().min(1).max(30),
}).strict();
const Revoke = z.object({ action: z.literal('revoke'), consent_id: z.string().uuid() }).strict();

/** Scoped, expiring consents. Revocation of voice retention deletes stored recordings immediately. */
export const POST = route(async (req) => {
  const u = await apiUser();
  const body = z.union([Grant, Revoke]).parse(await jsonBody(req));
  const db = adminClient();
  if (body.action === 'grant') {
    const now = new Date();
    const expires = new Date(now.getTime() + body.days * 86_400_000);
    const { data, error } = await db.from('consents').insert({ user_id: u.userId, purpose: body.purpose, artifact_id: body.artifact_id ?? null, granted_at: now.toISOString(), expires_at: expires.toISOString() }).select('consent_id').single();
    if (error) throw new HttpError(400, 'INVALID_CONSENT', 'Согласие не сохранено');
    await audit(u.userId, 'consent.granted', { id: data.consent_id, userId: u.userId }, { purpose: body.purpose, days: body.days });
    return { consent_id: data.consent_id };
  }
  const { data: c } = await db.from('consents').select('consent_id, purpose, revoked_at').eq('consent_id', body.consent_id).eq('user_id', u.userId).maybeSingle();
  if (!c) throw new HttpError(404, 'NOT_FOUND', 'Согласие не найдено');
  await db.from('consents').update({ revoked_at: new Date().toISOString() }).eq('consent_id', c.consent_id);
  if (c.purpose === 'voice_review_retention') {
    const { data: arts } = await db.from('voice_artifacts').select('id, object_path').eq('consent_id', c.consent_id).is('deleted_at', null);
    if (arts?.length) {
      await db.storage.from('voice-review').remove(arts.map((a) => a.object_path));
      await db.from('voice_artifacts').update({ deleted_at: new Date().toISOString() }).in('id', arts.map((a) => a.id));
    }
  }
  await audit(u.userId, 'consent.revoked', { id: c.consent_id, userId: u.userId }, { purpose: c.purpose });
  return { ok: true };
});
