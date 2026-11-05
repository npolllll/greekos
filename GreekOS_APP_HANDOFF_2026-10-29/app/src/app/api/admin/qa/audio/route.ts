import { route, jsonBody } from '@/lib/api';
import { apiOwner } from '@/lib/auth';
import { AudioDecision, ListenReview, decideAudioRelease, recordListening } from '@/lib/qa/audio-release';

/** Owner listening verdicts and audio release decisions (v6). */
export const POST = route(async (req) => {
  const owner = await apiOwner();
  const body = (await jsonBody(req)) as { action?: string };
  if (body.action === 'listen') return recordListening(owner, ListenReview.parse(body));
  if (body.action === 'release') return decideAudioRelease(owner, AudioDecision.parse(body));
  return Response.json({ error: 'BAD_ACTION', message: 'action: listen | release' }, { status: 400 });
});
