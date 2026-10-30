import { NextResponse } from 'next/server';
import { apiUser, handleRouteError, HttpError } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { releaseMap, signedAudioUrl } from '@/lib/content/repo';
import { env } from '@/lib/env';

/**
 * Short-lived signed URL for a released, digitally verified synthesized asset (owner: any asset).
 * DEV-PREVIEW accounts (local only, with ALLOW_LOCAL_VOICE_PLAYBACK_FOR_DEV) may also play local
 * renders that passed technical QA — clearly labelled in the UI, never a learner release.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ assetId: string }> }) {
  try {
    const u = await apiUser();
    const { assetId } = await ctx.params;
    const { data: a } = await adminClient().from('audio_assets').select('id, object_path, sha256, digital_status, rights_status, technical_status, invalidated_at').eq('id', assetId).maybeSingle();
    if (!a || !a.object_path) throw new HttpError(404, 'NOT_FOUND', 'Аудио не найдено');
    const devOk = u.devPreview && env.allowLocalVoicePlayback && !a.invalidated_at && a.technical_status === 'TECHNICAL_PASS' && ['AUDIO_VERIFIED_DIGITAL', 'NEEDS_REVIEW'].includes(a.digital_status);
    if (!u.isOwner && !devOk) {
      const rel = await releaseMap('audio_asset', [{ id: a.id, hash: a.sha256 ?? '' }]);
      if (a.invalidated_at || a.digital_status !== 'AUDIO_VERIFIED_DIGITAL' || a.rights_status !== 'PROVIDER_TERMS_RECORDED' || !rel.has(a.id)) throw new HttpError(403, 'AUDIO_PENDING', 'Аудио пока недоступно');
    }
    const url = await signedAudioUrl(a.object_path, 'course-audio', 300);
    if (!url) throw new HttpError(404, 'NOT_FOUND', 'Файл недоступен');
    return NextResponse.json({ url, expires_in: 300, synthetic: true }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return handleRouteError(e);
  }
}
