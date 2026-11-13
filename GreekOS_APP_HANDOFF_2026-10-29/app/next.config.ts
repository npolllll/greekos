import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), microphone=(self)' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
];

// Content-Security-Policy: the app talks only to itself and to its Supabase project (auth, data,
// realtime, signed audio URLs); the optional voice gateway is added when configured. Next.js injects
// inline bootstrap scripts and styles, hence 'unsafe-inline' (no third-party script is allowed).
// Development keeps Next's eval-based tooling working by sending no CSP.
function csp(): string {
  const supa = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
  const ws = supa.replace(/^http/, 'ws');
  const gateway = (process.env.NEXT_PUBLIC_VOICE_GATEWAY_URL ?? '').replace(/\/$/, '');
  const connect = ["'self'", supa, ws, gateway].filter(Boolean).join(' ');
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${supa}`.trim(),
    `media-src 'self' data: blob: ${supa}`.trim(),
    "font-src 'self' data:",
    `connect-src ${connect}`,
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}
if (process.env.NODE_ENV === 'production') securityHeaders.push({ key: 'Content-Security-Policy', value: csp() });

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Local development is served on 127.0.0.1 (Supabase local URLs use it too).
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  productionBrowserSourceMaps: false,
  typedRoutes: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
