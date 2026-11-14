import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { requestOrigin } from './lib/http/origin';

/** Refreshes the Supabase session cookie; authorization itself happens in server handlers. */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });
  // getClaims verifies the access token (locally with the project's signing keys when available) and
  // refreshes an expired session; pages and APIs still verify the user with the auth server.
  const { data } = await supabase.auth.getClaims();
  const signedIn = !!data?.claims?.sub;
  const path = request.nextUrl.pathname;
  const isPublic = path.startsWith('/login') || path.startsWith('/register') || path.startsWith('/auth') || path.startsWith('/api/cron') || path.startsWith('/api/health');
  if (!signedIn && !isPublic && !path.startsWith('/api/')) {
    // On the host the browser used (not the server's bind host): the session cookie lives there.
    return NextResponse.redirect(`${requestOrigin(request)}/login`);
  }
  return response;
}

export const config = {
  // Public static art (scene/) and the audio worklet are served without a session check.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt|voice-capture-worklet.js|scene/|api/voice/stream).*)'],
};
