import { z } from 'zod';
import { NextResponse } from 'next/server';
import { route, jsonBody } from '@/lib/api';
import { apiUser } from '@/lib/auth';
import { startSession, learnerTurn, help, speak, endSession, sessionView } from '@/lib/speaking/service';
import { BudgetExceededError } from '@/lib/providers/budget';
import { ProviderUnavailableError } from '@/lib/providers/speech';

export const maxDuration = 60;

const MODES = ['a0_guided', 'course', 'roleplay', 'free_talk', 'tutor_help', 'b2_mock', 'real_greek'] as const;
const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start'), scenario_id: z.string().max(20), mode: z.enum(MODES), input_mode: z.enum(['voice', 'text_fallback']), idempotency_key: z.string().min(8).max(120), voice_persona: z.enum(['TUTOR_F', 'TUTOR_M']).nullable().optional(), transport: z.enum(['batch', 'stream_local_gateway']).optional() }),
  z.object({ action: z.literal('turn'), session_id: z.string().uuid(), text: z.string().max(1200), source: z.enum(['asr_confirmed', 'learner_corrected', 'typed']), asr_confidence: z.number().min(0).max(1).nullable(), help_used: z.array(z.string().max(40)).max(10), repair: z.boolean(), interrupted_previous: z.boolean(), idempotency_key: z.string().min(8).max(120) }),
  z.object({ action: z.literal('help'), session_id: z.string().uuid(), kind: z.enum(['hint', 'translate', 'explain', 'how_to_say']), question: z.string().max(300).optional() }),
  z.object({ action: z.literal('speak'), session_id: z.string().uuid(), turn_id: z.string().uuid(), rate: z.enum(['slow', 'normal', 'fast']) }),
  z.object({ action: z.literal('end'), session_id: z.string().uuid() }),
  z.object({ action: z.literal('state'), session_id: z.string().uuid() }),
]);

export const POST = route(async (req) => {
  const u = await apiUser();
  const b = Body.parse(await jsonBody(req));
  try {
    if (b.action === 'start') return await startSession(u, b);
    if (b.action === 'turn') return await learnerTurn(u, b);
    if (b.action === 'help') return await help(u, b);
    if (b.action === 'speak') return await speak(u, b);
    if (b.action === 'end') return await endSession(u, b.session_id);
    return await sessionView(u, b.session_id);
  } catch (e) {
    if (e instanceof BudgetExceededError) return NextResponse.json({ error: 'BUDGET_EXCEEDED', message: e.message }, { status: 429 });
    if (e instanceof ProviderUnavailableError) return NextResponse.json({ error: 'PROVIDER_UNAVAILABLE', message: e.message }, { status: 503 });
    throw e;
  }
});
