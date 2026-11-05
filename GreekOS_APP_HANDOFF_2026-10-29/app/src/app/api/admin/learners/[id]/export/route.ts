import { NextResponse } from 'next/server';
import { apiOwner, audit, handleRouteError, HttpError } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { exportLearnerData } from '@/lib/privacy';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const owner = await apiOwner();
    const { id } = await ctx.params;
    const { data: p } = await adminClient().from('profiles').select('user_id').eq('user_id', id).maybeSingle();
    if (!p) throw new HttpError(404, 'NOT_FOUND', 'Ученик не найден');
    const data = await exportLearnerData(id);
    await audit(owner.userId, 'learner.export_by_owner', { id, userId: id });
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="greekos-learner-${id.slice(0, 8)}.json"`, 'cache-control': 'no-store' },
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
