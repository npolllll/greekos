import { upgradeWebSocket } from '@vercel/functions';
import { env } from '@/lib/env';
import { attachStreamConnection, streamOriginAllowed } from '@/lib/speaking/gateway';

/**
 * Live (streaming, two-way) voice inside the app's own deployment: a WebSocket Vercel Function on
 * Fluid compute. The protocol, authentication (60 s single-use token from /api/speaking/stream-token)
 * and conversation engine are the same as in the standalone gateway; provider keys stay on the server.
 * A connection lives at most `maxDuration`; the session hands over to a fresh one at a quiet moment.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: Request): Promise<Response> {
  if (!env.voiceStreamBuiltin) return new Response('Live voice is not enabled on this deployment', { status: 404 });
  if ((req.headers.get('upgrade') ?? '').toLowerCase() !== 'websocket') return new Response('WebSocket only', { status: 426, headers: { upgrade: 'websocket' } });
  if (!streamOriginAllowed(req.headers.get('origin'))) return new Response('Forbidden', { status: 403 });
  return upgradeWebSocket((ws) => { attachStreamConnection(ws, { maxMs: maxDuration * 1000 }); }, { maxPayload: 256 * 1024 });
}
