import { route, jsonBody } from '@/lib/api';
import { apiUser } from '@/lib/auth';
import { AttemptRequest, submitAttempt } from '@/lib/learning/attempts';

/** POST /api/attempts — server-authoritative evaluation; user from session, never from body. */
export const POST = route(async (req) => {
  const user = await apiUser();
  const body = AttemptRequest.parse(await jsonBody(req));
  return submitAttempt(user, body);
});
