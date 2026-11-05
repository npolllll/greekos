import { route, jsonBody } from '@/lib/api';
import { RegisterRequest, registerLearner } from '@/lib/registration';

/** Public: a visitor asks for a learner account (checked against the owner's registration settings). */
export const POST = route(async (req) => {
  const b = RegisterRequest.parse(await jsonBody(req));
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || req.headers.get('x-real-ip') || 'local';
  return registerLearner(b, ip);
});
