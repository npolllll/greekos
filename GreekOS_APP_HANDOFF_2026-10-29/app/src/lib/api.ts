import 'server-only';
import { NextResponse } from 'next/server';
import { handleRouteError, HttpError } from './auth.ts';
import { adminClient } from './supabase/admin.ts';

/** Unexpected (500) errors go to the owner's log: route, method, class and a short message only. */
function recordServerError(req: Request, e: unknown) {
  if (e instanceof HttpError) return;
  const err = e as { name?: string; code?: string; message?: string };
  if (err?.name === 'ZodError' || err?.code === 'INVALID_RESPONSE' || err?.code === 'UNSUPPORTED_CONTENT_TYPE') return;
  let path = '';
  try { path = new URL(req.url).pathname; } catch { path = '?'; }
  // Ids in paths are kept (they identify the failing object, not a person's data); bodies never are.
  void Promise.resolve(adminClient().from('server_errors').insert({ method: req.method, path: path.slice(0, 200), kind: String(err?.name ?? 'Error').slice(0, 60), message: String(err?.message ?? e).replace(/\s+/g, ' ').slice(0, 300) })).catch(() => undefined);
}

/** Wraps a route handler: JSON body parse + uniform error mapping. */
export function route<T>(fn: (req: Request, ctx: T) => Promise<unknown>) {
  return async (req: Request, ctx: T) => {
    try {
      const out = await fn(req, ctx);
      return out instanceof Response ? out : NextResponse.json(out ?? { ok: true });
    } catch (e) {
      recordServerError(req, e);
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
