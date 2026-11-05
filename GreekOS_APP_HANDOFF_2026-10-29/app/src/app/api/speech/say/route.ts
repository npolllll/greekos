import { z } from 'zod';
import { route, jsonBody } from '@/lib/api';
import { apiUser } from '@/lib/auth';
import { phraseAudio } from '@/lib/audio/phrase';

const Body = z.object({ unit_id: z.string().min(1).max(40), text: z.string().min(1).max(600), speed: z.enum(['normal', 'slow']).default('normal') }).strict();

export const POST = route(async (req) => {
  const u = await apiUser();
  return phraseAudio(u, Body.parse(await jsonBody(req)));
});
