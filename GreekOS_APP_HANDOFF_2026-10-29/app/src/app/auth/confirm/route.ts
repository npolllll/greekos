import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase/server';
import { requestOrigin } from '@/lib/http/origin';

const ALLOWED: EmailOtpType[] = ['invite', 'recovery', 'magiclink', 'email'];

/**
 * Exchanges a one-time email token for a session (invite / self-registration / recovery / magic link).
 * The redirect stays on the host the browser opened the link on, so the session cookie set here is
 * sent with the next page (a URL built from the server's own host — e.g. «localhost» behind
 * «127.0.0.1» or a proxy — loses the session and reads as «invalid link»).
 */
function go(request: NextRequest, path: string) {
  return NextResponse.redirect(`${requestOrigin(request)}${path}`, 303);
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;
  const nextParam = url.searchParams.get('next') ?? '/';
  const next = nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/';
  if (tokenHash && type && ALLOWED.includes(type)) {
    const supabase = await serverClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return go(request, next);
  }
  return go(request, '/login?error=link');
}
