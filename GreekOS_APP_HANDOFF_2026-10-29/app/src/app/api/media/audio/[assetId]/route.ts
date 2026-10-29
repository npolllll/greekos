import { NextResponse } from 'next/server';
import { apiUser, handleRouteError, HttpError } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { releaseMap, signedAudioUrl } from '@/lib/content/repo';

/** Short-lived signed URL for a released, digitally verified synthesized asset (owner: any asset). */
export async function GET(_req: Request, ctx: { params: Promise<{ assetId: string }> }) {
  try {
    const u = await apiUser();
    const { assetId } = await ctx.params;
    const { data: a } = await adminClient().from('audio_assets').select('id, object_path, sha256, digital_status, rights_status, invalidated_at').eq('id', assetId).maybeSingle();
    if (!a || !a.object_path) throw new HttpError(404, 'NOT_FOUND', 'Аудио не найдено');
    if (!u.isOwner) {
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
