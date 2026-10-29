import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

/**
 * Short-lived credential for the voice gateway, minted by the Next.js server after verifying the
 * Supabase session and session ownership. Bound to user + speaking session; 60 s lifetime.
 * Provider keys never reach the browser — the gateway holds them server-side.
 */
export interface StreamClaims { sub: string; sid: string; exp: number; jti: string }

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64url');

export function mintStreamToken(secret: string, userId: string, sessionId: string, ttlSeconds = 60): string {
  const claims: StreamClaims = { sub: userId, sid: sessionId, exp: Math.floor(Date.now() / 1000) + ttlSeconds, jti: randomUUID() };
  const body = b64(JSON.stringify(claims));
  return `${body}.${b64(createHmac('sha256', secret).update(body).digest())}`;
}

export function verifyStreamToken(secret: string, token: string): StreamClaims | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', secret).update(body).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const c = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as StreamClaims;
    if (!c.sub || !c.sid || typeof c.exp !== 'number' || c.exp < Math.floor(Date.now() / 1000)) return null;
    return c;
  } catch {
    return null;
  }
}

/** Splits a reply into sentences so speech can start before the whole reply is synthesized. */
export function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?;…·]+[.!?;…·]*["»)]?\s*/gu) ?? [text];
  const out: string[] = [];
  for (const p of parts.map((x) => x.trim()).filter(Boolean)) {
    if (out.length && p.length < 12) out[out.length - 1] += ` ${p}`;
    else out.push(p);
  }
  return out.length ? out : [text.trim()];
}
