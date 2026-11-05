import { NextResponse } from 'next/server';
import { apiUser, handleRouteError } from '@/lib/auth';
import { attemptState } from '@/lib/exams/service';

export const dynamic = 'force-dynamic';

/** GET — reconnect: authoritative server time, status, autosaved answers, results after submit. */
export async function GET(_req: Request, ctx: { params: Promise<{ attemptId: string }> }) {
  try {
    const user = await apiUser();
    const { attemptId } = await ctx.params;
    if (!/^[0-9a-f-]{36}$/i.test(attemptId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    return NextResponse.json(await attemptState(user, attemptId), { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return handleRouteError(e);
  }
}
