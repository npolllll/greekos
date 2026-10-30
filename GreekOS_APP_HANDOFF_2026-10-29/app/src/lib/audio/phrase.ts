import 'server-only';
import { createHash } from 'node:crypto';
import { adminClient } from '../supabase/admin.ts';
import { HttpError, type SessionUser } from '../session-user.ts';
import { releaseMap } from '../content/repo.ts';
import { loadCastingContext } from './pipeline.ts';
import { synthesizeWithVoice } from '../providers/speech.ts';
import { localAsrHealth, localTranscribe } from '../providers/local-engines.ts';
import { analyzeWav } from './wav.ts';
import { roundTrip, roundTripPass } from './roundtrip.ts';
import { env } from '../env.ts';
import type { CatalogVoice } from '../voice/catalog.ts';
import { lessonWords } from '../alphabet/reference.ts';

export const PHRASE_SYNTHESIS_VERSION = 'greekos-phrase/1.0';

const norm = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim();

/** Texts the learner may have voiced for one unit: its examples, vocabulary lemmas and examples, and the Greek words its theory uses (letter names, sample words). */
async function unitPhrases(unitId: string, viewer: SessionUser): Promise<Set<string>> {
  const db = adminClient();
  const { data: unit } = await db.from('units').select('unit_id, current_hash, teaching').eq('unit_id', unitId).maybeSingle();
  if (!unit) throw new HttpError(404, 'NOT_FOUND', 'Урок не найден');
  const released = (await releaseMap('unit', [{ id: unit.unit_id, hash: unit.current_hash }], viewer)).has(unit.unit_id);
  if (!released && !viewer.isOwner) throw new HttpError(403, 'CONTENT_GATED', 'Урок на проверке');
  const t = unit.teaching as { theory_ru?: string; examples_el?: string[]; vocabulary_items?: Array<{ lemma?: string; example?: string }> };
  const theoryWords = t.theory_ru ? lessonWords(t.theory_ru, []) : [];
  return new Set([...(t.examples_el ?? []), ...theoryWords, ...(t.vocabulary_items ?? []).flatMap((v) => [v.lemma ?? '', v.example ?? ''])].map(norm).filter(Boolean));
}

/** Narrator voice for phrases: the voice cast for NARRATOR_F (or NARRATOR_M), as the owner set it. */
async function narratorVoice(viewer: SessionUser): Promise<CatalogVoice> {
  const ctx = await loadCastingContext();
  for (const id of ['NARRATOR_F', 'NARRATOR_M']) {
    const r = ctx.castRoles.get(id);
    const v = r?.voice_id ? ctx.voices.get(r.voice_id) : undefined;
    if (!v || !v.available) continue;
    if (v.engine_kind === 'local' && !env.localEnginesAllowed) continue;
    // Ordinary learners hear only voices the owner approved and that may be distributed.
    if (!viewer.isOwner && !viewer.devPreview && !(v.approved_by_owner && v.distribution_allowed)) continue;
    return v;
  }
  throw new HttpError(503, 'TTS_UNAVAILABLE', 'Озвучка сейчас недоступна: нет утверждённого голоса диктора.');
}

export async function phraseAudio(viewer: SessionUser, input: { unit_id: string; text: string; speed: 'normal' | 'slow' }) {
  const text = norm(input.text);
  if (!(await unitPhrases(input.unit_id, viewer)).has(text)) throw new HttpError(403, 'NOT_IN_LESSON', 'Озвучиваются только фразы этого урока.');
  const voice = await narratorVoice(viewer);
  const key = createHash('sha256').update(JSON.stringify([PHRASE_SYNTHESIS_VERSION, voice.voice_id, input.speed, text])).digest('hex');
  const db = adminClient();
  const { data: hit } = await db.from('tts_cache_entries').select('object_path, duration_ms, roundtrip, qa_verdict, dev_only, hits').eq('cache_key', key).maybeSingle();
  let entry = hit;
  if (!entry) {
    const asr = env.localEnginesAllowed ? await localAsrHealth() : null;
    const model = asr?.available.includes('turbo') ? 'turbo' : asr?.available.includes('small') ? 'small' : null;
    let best: { bytes: Uint8Array; metrics: ReturnType<typeof roundTrip>; hyp: string } | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const out = await synthesizeWithVoice(text, voice, { speed: input.speed, userId: viewer.userId, operation: 'tts_phrase' });
      const tech = analyzeWav(out.bytes);
      if (!tech?.pass) continue;
      if (!model) { best = { bytes: out.bytes, metrics: roundTrip(text, ''), hyp: '' }; break; }
      const hyp = (await localTranscribe(out.bytes, model, 120_000)).text;
      const metrics = roundTrip(text, hyp);
      if (!best || metrics.cer_phonetic < best.metrics.cer_phonetic) best = { bytes: out.bytes, metrics, hyp };
      if (roundTripPass(metrics)) break;
    }
    if (!best || !model) throw new HttpError(503, 'TTS_QA_UNAVAILABLE', 'Озвучка не прошла проверку распознаванием — фраза не показывается без проверки.');
    const pass = roundTripPass(best.metrics);
    if (!pass && !viewer.isOwner && !viewer.devPreview) throw new HttpError(422, 'TTS_QA_FAILED', 'Синтез этой фразы не прошёл автоматическую проверку. Мы не показываем непроверенный звук.');
    const sha = createHash('sha256').update(best.bytes).digest('hex');
    const path = `phrases/${key}.wav`;
    const up = await db.storage.from('tts-cache').upload(path, best.bytes, { contentType: 'audio/wav', upsert: true });
    if (up.error) throw new Error(up.error.message);
    const row = {
      cache_key: key, text_el: text, voice_id: voice.voice_id, speed: input.speed, synthesis_version: PHRASE_SYNTHESIS_VERSION, object_path: path, sha256: sha,
      duration_ms: analyzeWav(best.bytes)?.duration_ms ?? null, roundtrip: { ...best.metrics, hypothesis: best.hyp, engine: `local:whisper-${model}` },
      qa_verdict: pass ? 'PASS' : 'NEEDS_REVIEW', dev_only: !voice.distribution_allowed || !voice.approved_by_owner,
    };
    await db.from('tts_cache_entries').upsert(row);
    entry = { ...row, hits: 0 };
  } else {
    if (entry.qa_verdict !== 'PASS' && !viewer.isOwner && !viewer.devPreview) throw new HttpError(422, 'TTS_QA_FAILED', 'Синтез этой фразы не прошёл автоматическую проверку.');
    await db.from('tts_cache_entries').update({ hits: (entry.hits ?? 0) + 1 }).eq('cache_key', key);
  }
  const { data: signed } = await db.storage.from('tts-cache').createSignedUrl(entry.object_path, 300);
  if (!signed?.signedUrl) throw new HttpError(404, 'NOT_FOUND', 'Файл недоступен');
  return { url: signed.signedUrl, duration_ms: entry.duration_ms, voice: voice.display_name, qa: entry.qa_verdict, dev_only: entry.dev_only, synthetic: true };
}
