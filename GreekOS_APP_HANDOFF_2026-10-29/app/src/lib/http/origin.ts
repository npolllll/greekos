/**
 * The origin the browser actually used (Host / X-Forwarded-* headers), for redirects. Next's own
 * request URL may name the server's bind host instead (e.g. «localhost» when the browser opened
 * «127.0.0.1», or an internal host behind a proxy); redirecting there moves the browser to another
 * origin, away from its session cookie.
 */
export function requestOrigin(req: { headers: Headers; nextUrl?: { protocol: string; host: string } }): string {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? req.nextUrl?.host ?? 'localhost';
  const proto = (req.headers.get('x-forwarded-proto') ?? req.nextUrl?.protocol ?? 'http:').replace(/:$/, '').split(',')[0].trim();
  return `${proto}://${host.split(',')[0].trim()}`;
}
