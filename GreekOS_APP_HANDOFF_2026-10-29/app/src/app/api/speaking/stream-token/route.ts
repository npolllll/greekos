import { z } from 'zod';
import { route, jsonBody } from '@/lib/api';
import { apiUser, HttpError } from '@/lib/auth';
import { env } from '@/lib/env';
import { adminClient } from '@/lib/supabase/admin';
import { mintStreamToken } from '@/lib/speaking/stream-token';
import { GATEWAY_PATH } from '@/lib/speaking/stream-protocol';

const Body = z.object({ session_id: z.string().uuid() });

/**
 * Short-lived credential for the streaming voice gateway: bound to the verified Supabase user and
 * one of their active voice sessions, single use, 60 s. Provider keys never leave the servers.
 */
export const POST = route(async (req) => {
  const u = await apiUser();
  const { session_id } = Body.parse(await jsonBody(req));
  const secret = env.voiceGatewaySecret;
  const base = env.voiceGatewayPublicUrl;
  if (!secret || !base) throw new HttpError(503, 'STREAM_UNAVAILABLE', 'Потоковый голосовой канал не настроен — используется пошаговый режим.');
  const { data: s } = await adminClient().from('speaking_sessions').select('user_id, status, input_mode').eq('session_id', session_id).maybeSingle();
  if (!s || s.user_id !== u.userId) throw new HttpError(404, 'NOT_FOUND', 'Разговор не найден');
  if (s.status !== 'ACTIVE') throw new HttpError(409, 'SESSION_CLOSED', 'Разговор уже завершён');
  if (s.input_mode !== 'voice') throw new HttpError(422, 'VOICE_SESSION', 'Потоковый канал только для голосового режима.');
  return { token: mintStreamToken(secret, u.userId, session_id, 60), url: `${base.replace(/\/$/, '')}${GATEWAY_PATH}`, expires_in: 60 };
});
