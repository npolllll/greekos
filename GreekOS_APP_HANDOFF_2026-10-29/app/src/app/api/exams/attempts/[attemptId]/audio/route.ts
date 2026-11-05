import { z } from 'zod';
import { NextResponse } from 'next/server';
import { apiUser, handleRouteError } from '@/lib/auth';
import { jsonBody } from '@/lib/api';
import { examAudioPlay } from '@/lib/exams/service';

const Body = z.object({ asset_id: z.string().uuid() });

/** POST — one counted play of an exam listening recording (limit enforced on the server). */
export async function POST(req: Request, ctx: { params: Promise<{ attemptId: string }> }) {
  try {
    const user = await apiUser();
    const { attemptId } = await ctx.params;
    if (!/^[0-9a-f-]{36}$/i.test(attemptId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    const { asset_id } = Body.parse(await jsonBody(req));
    return NextResponse.json(await examAudioPlay(user, attemptId, asset_id), { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return handleRouteError(e);
  }
}
