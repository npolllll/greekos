import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase/server';

const ALLOWED: EmailOtpType[] = ['invite', 'recovery', 'magiclink', 'email'];

/** Exchanges a one-time email token for a session (invite / recovery / magic link). */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;
  const nextParam = url.searchParams.get('next') ?? '/';
  const next = nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/';
  const target = request.nextUrl.clone();
  target.search = '';
  if (tokenHash && type && ALLOWED.includes(type)) {
    const supabase = await serverClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      target.pathname = next;
      return NextResponse.redirect(target);
    }
  }
  target.pathname = '/login';
  target.searchParams.set('error', 'link');
  return NextResponse.redirect(target);
}
