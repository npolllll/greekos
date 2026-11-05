import { NextResponse } from 'next/server';
import { apiUser, audit, handleRouteError } from '@/lib/auth';
import { exportLearnerData } from '@/lib/privacy';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const u = await apiUser();
    const data = await exportLearnerData(u.userId);
    await audit(u.userId, 'learner.export', { userId: u.userId });
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="greekos-export-${new Date().toISOString().slice(0, 10)}.json"`, 'cache-control': 'no-store' },
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
