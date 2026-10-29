import 'server-only';
import { NextResponse } from 'next/server';
import { handleRouteError } from './auth.ts';

/** Wraps a route handler: JSON body parse + uniform error mapping. */
export function route<T>(fn: (req: Request, ctx: T) => Promise<unknown>) {
  return async (req: Request, ctx: T) => {
    try {
      const out = await fn(req, ctx);
      return out instanceof Response ? out : NextResponse.json(out ?? { ok: true });
    } catch (e) {
      return handleRouteError(e);
    }
  };
}

export async function jsonBody(req: Request, maxBytes = 64_000): Promise<unknown> {
  const text = await req.text();
  if (text.length > maxBytes) throw Object.assign(new Error('too large'), { code: 'INVALID_RESPONSE', message: 'Слишком большой запрос' });
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw Object.assign(new Error('bad json'), { name: 'ZodError' });
  }
}
