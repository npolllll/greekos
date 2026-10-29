import { NextResponse } from 'next/server';
import { apiOwner, handleRouteError, HttpError } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/** Owner-only signed URL for a voice audition sample. */
export async function GET(req: Request) {
  try {
    await apiOwner();
    const id = new URL(req.url).searchParams.get('voice_id') ?? '';
    const { data } = await adminClient().from('voice_catalog').select('sample_object_path').eq('voice_id', id).maybeSingle();
    if (!data?.sample_object_path) throw new HttpError(404, 'NOT_FOUND', 'Образца нет');
    const { data: signed } = await adminClient().storage.from('tts-cache').createSignedUrl(data.sample_object_path, 300);
    return NextResponse.json({ url: signed?.signedUrl ?? null }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return handleRouteError(e);
  }
}
