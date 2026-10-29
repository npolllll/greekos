import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { adminClient } from '../supabase/admin.ts';
import { audit, HttpError, type SessionUser } from '../auth.ts';
import { env } from '../env.ts';
import { llmConfigured, structuredCall } from '../providers/llm.ts';
import { asrStatus, synthesize, transcribe, ttsStatus } from '../providers/speech.ts';
import { analyzeWav } from '../audio/wav.ts';
import { roundTrip, roundTripPass } from '../audio/roundtrip.ts';
import { stableStringify } from '../content/stable-json.ts';
import type { ItemEnvelope } from '../content/types.ts';

export const LINGUISTIC_QA_TOOL = 'linguistic-qa/1';

const QaOutput = z.object({
  verdict: z.enum(['PASS', 'NEEDS_REVIEW', 'ABSTAIN']),
  issues: z.array(z.object({
    field: z.enum(['prompt', 'stimulus', 'options', 'key', 'model_response', 'criteria']),
    quote: z.string(),
    problem_ru: z.string(),
    suggestion: z.string().nullable(),
    severity: z.enum(['blocking', 'minor']),
  })),
  key_ambiguity: z.boolean(),
  missing_plausible_alternatives: z.array(z.string()),
  accent_or_spelling_issues: z.array(z.string()),
  register_note_ru: z.string().nullable(),
  summary_ru: z.string(),
});

const SYSTEM = `Ты выполняешь автоматическую лингвистическую проверку учебного задания по новогреческому языку для русскоязычных учеников.
Проверь: грамматику и орфографию греческого текста (включая ударения), однозначность ключа, наличие других допустимых ответов, корректность дистракторов, соответствие регистра, понятность русской формулировки.
Правила: каждая цитата quote — дословная подстрока соответствующего поля задания. Не переписывай задание целиком. Если не уверен — NEEDS_REVIEW или ABSTAIN.
PASS только если нет блокирующих проблем и ключ однозначен. Это цифровая проверка, а не экспертиза преподавателя.`;

function fieldsOf(e: ItemEnvelope): Record<string, string> {
  return {
    prompt: e.prompt,
    stimulus: typeof e.stimulus === 'string' ? e.stimulus : JSON.stringify(e.stimulus ?? ''),
    options: JSON.stringify(e.options ?? []),
    key: JSON.stringify([...(e.answer ?? []), ...(e.accepted_alternatives ?? [])]),
    model_response: typeof e.model_response === 'string' ? e.model_response : JSON.stringify(e.model_response ?? ''),
    criteria: JSON.stringify(e.criteria ?? []),
  };
}

/** Runs one DIGITAL_LINGUISTIC_QA pass bound to the item's current hash. Never a human verification. */
export async function runLinguisticQa(actor: SessionUser, itemId: string) {
  if (!llmConfigured()) throw new HttpError(409, 'LLM_NOT_CONFIGURED', 'Цифровая проверка недоступна: не задан ANTHROPIC_API_KEY.');
  const db = adminClient();
  const { data: item } = await db.from('items').select('item_id, current_hash, envelope').eq('item_id', itemId).maybeSingle();
  if (!item) throw new HttpError(404, 'NOT_FOUND', 'Задание не найдено');
  const e = item.envelope as ItemEnvelope;
  const fields = fieldsOf(e);
  const r = await structuredCall({
    userId: actor.userId, operation: 'linguistic_qa', model: env.llmModelAssessor, system: SYSTEM,
    user: `Задание ${e.item_id} (${e.type}, уровень ${e.level ?? '—'}, модуль ${e.module}).\n${Object.entries(fields).map(([k, v]) => `[${k}]\n${v}`).join('\n\n')}`,
    schema: QaOutput, effort: 'medium', maxTokens: 8000, timeoutMs: 90_000,
  });
  let verdict: 'PASS' | 'NEEDS_REVIEW' | 'ABSTAIN' = 'ABSTAIN';
  let report: Record<string, unknown> = { reason: r.ok ? null : r.reason };
  if (r.ok) {
    const bad = r.data.issues.find((i) => !fields[i.field]?.includes(i.quote));
    if (bad) report = { reason: 'HALLUCINATED_QUOTE', field: bad.field };
    else {
      verdict = r.data.verdict === 'PASS' && (r.data.key_ambiguity || r.data.issues.some((i) => i.severity === 'blocking')) ? 'NEEDS_REVIEW' : r.data.verdict;
      report = { ...r.data, model: r.model };
    }
  }
  const { data: run, error } = await db.from('digital_qa_runs').insert({
    content_kind: 'item', content_id: item.item_id, content_hash: item.current_hash, check_kind: 'DIGITAL_LINGUISTIC_QA',
    tool_id: `${LINGUISTIC_QA_TOOL}:${r.ok ? r.model : env.llmModelAssessor}`, verdict, report, run_by: actor.userId,
  }).select('id').single();
  if (error) throw new Error(error.message);
  await audit(actor.userId, 'qa.linguistic', { id: item.item_id }, { verdict, run_id: run.id });
  return { verdict, report, run_id: run.id };
}

/** Minimal live calls to configured providers; results logged without secrets. */
export async function checkProviders(actor: SessionUser) {
  const results: Record<string, unknown> = {};
  if (llmConfigured()) {
    const r = await structuredCall({ userId: actor.userId, operation: 'provider_check', model: env.llmModelDialogue, system: 'Ответь строго по схеме.', user: 'Верни ok=true и echo="Καλημέρα".', schema: z.object({ ok: z.boolean(), echo: z.string() }), effort: 'low', maxTokens: 1000, timeoutMs: 30_000 });
    results.llm = r.ok ? { status: 'OK', model: r.model, echo_ok: r.data.echo.includes('Καλημέρα') } : { status: 'FAILED', reason: r.reason };
  } else results.llm = { status: 'NOT_CONFIGURED' };
  let wav: Uint8Array | null = null;
  const tts = ttsStatus();
  if (tts.configured) {
    try {
      const out = await synthesize('Καλημέρα σας. Τι κάνετε;', { userId: actor.userId, operation: 'provider_check' });
      wav = out.bytes;
      const tech = analyzeWav(out.bytes);
      results.tts = { status: tech?.pass ? 'OK' : 'TECHNICAL_FAIL', provider: out.provider, voice: out.voice, synthetic_transport: tts.synthetic, duration_ms: tech?.duration_ms ?? null, checks: tech?.checks ?? null };
    } catch (e) {
      results.tts = { status: 'FAILED', provider: tts.provider, reason: (e as Error).message.slice(0, 160) };
    }
  } else results.tts = { status: 'NOT_CONFIGURED' };
  const asr = asrStatus();
  if (asr.configured && wav) {
    try {
      const t = await transcribe(wav, actor.userId);
      const m = roundTrip('Καλημέρα σας. Τι κάνετε;', t.text);
      results.asr = { status: roundTripPass(m) ? 'OK' : 'ROUNDTRIP_MISMATCH', provider: t.provider, synthetic_transport: t.synthetic, confidence: t.confidence, metrics: m };
    } catch (e) {
      results.asr = { status: 'FAILED', provider: asr.provider, reason: (e as Error).message.slice(0, 160) };
    }
  } else results.asr = { status: asr.configured ? 'SKIPPED_NO_TTS_AUDIO' : 'NOT_CONFIGURED' };
  const digest = createHash('sha256').update(stableStringify(results)).digest('hex');
  await audit(actor.userId, 'providers.check', { id: digest.slice(0, 16) }, { results, checked_at: new Date().toISOString() });
  return { results, digest };
}
