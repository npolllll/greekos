import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { apiUser, handleRouteError, HttpError } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { parseWav } from '@/lib/audio/wav';
import { transcribe, ProviderUnavailableError } from '@/lib/providers/speech';
import { BudgetExceededError } from '@/lib/providers/budget';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_BYTES = 4_000_000; // ~2 min of 16 kHz mono PCM16
const LOW_CONFIDENCE = 0.6;

/**
 * Transcribe one learner utterance (16 kHz mono WAV produced in the browser). Raw audio is
 * processed in memory and discarded unless the learner holds an active, unexpired retention
 * consent and a speaking session id is given (then: private bucket, ≤30 days).
 */
export async function POST(req: Request) {
  try {
    const u = await apiUser();
    const url = new URL(req.url);
    const sessionId = url.searchParams.get('session_id');
    const buf = new Uint8Array(await req.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) throw new HttpError(413, 'TOO_LARGE', 'Слишком длинная запись. Говорите короче (до 2 минут).');
    const info = parseWav(buf);
    if (!info) throw new HttpError(400, 'INVALID_AUDIO', 'Запись не распознана как аудио.');
    if (info.durationMs < 300) throw new HttpError(422, 'TOO_SHORT', 'Запись слишком короткая.');
    const r = await transcribe(buf, u.userId);
    let stored = false;
    if (sessionId) {
      const db = adminClient();
      const { data: s } = await db.from('speaking_sessions').select('session_id').eq('session_id', sessionId).eq('user_id', u.userId).maybeSingle();
      const { data: consent } = await db.from('consents').select('consent_id, expires_at').eq('user_id', u.userId).eq('purpose', 'voice_review_retention').is('revoked_at', null).gt('expires_at', new Date().toISOString()).order('granted_at', { ascending: false }).limit(1).maybeSingle();
      if (s && consent) {
        const path = `${u.userId}/${sessionId}/${randomUUID()}.wav`;
        const up = await db.storage.from('voice-review').upload(path, buf, { contentType: 'audio/wav' });
        if (!up.error) {
          await db.from('voice_artifacts').insert({ user_id: u.userId, session_id: sessionId, consent_id: consent.consent_id, object_path: path, retention_until: consent.expires_at });
          stored = true;
        }
      }
    }
    const uncertain = !r.text || r.confidence === null || r.confidence < LOW_CONFIDENCE;
    return NextResponse.json({
      text: r.text, confidence: r.confidence, provider: r.provider, synthetic: r.synthetic, duration_ms: info.durationMs,
      status: !r.text ? 'EMPTY' : uncertain ? 'NEEDS_CONFIRMATION' : 'CONFIDENT', stored,
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    if (e instanceof ProviderUnavailableError) return NextResponse.json({ error: 'PROVIDER_UNAVAILABLE', message: e.message }, { status: 503 });
    if (e instanceof BudgetExceededError) return NextResponse.json({ error: 'BUDGET_EXCEEDED', message: e.message }, { status: 429 });
    return handleRouteError(e);
  }
}
