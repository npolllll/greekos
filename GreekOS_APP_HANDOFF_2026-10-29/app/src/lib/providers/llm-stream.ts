/**
 * Streaming, schema-constrained LLM call for live conversation. The JSON schema puts the spoken
 * reply first, so callers can voice it sentence by sentence while the rest of the object (stage,
 * feedback, memory) is still being generated.
 *
 * Providers (same contract, chosen by env — see llm.ts):
 *  - openai_compatible: POST {LLM_BASE_URL}/v1/chat/completions, stream:true, response_format
 *    json_schema (the GreekOS local server, llama.cpp server, vLLM, LM Studio, cloud gateways).
 *    `user` carries the session id so a local server can keep that conversation's KV cache.
 *  - anthropic: Messages API with stream:true and output_config.format json_schema.
 * Every failure is a typed reason; the caller decides on an honestly labelled fallback.
 */
import Anthropic from '@anthropic-ai/sdk';
import { env } from '../env.ts';
import { assertBudget, COST, recordUsage } from './budget.ts';
import { llmConfigured, isLocalLlm } from './llm.ts';

export interface StreamJsonParams {
  userId: string | null;
  operation: string;
  model?: string;
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  schema: Record<string, unknown>;
  maxTokens: number;
  timeoutMs: number;
  temperature?: number;
  signal?: AbortSignal;
  /** Conversation key for server-side prompt caching (local server KV slot). */
  cacheKey?: string;
  /** Claude effort (cloud only). A live conversation turn is latency-bound: 'low' by default. */
  effort?: 'low' | 'medium' | 'high';
  onText?: (chunk: string) => void;
}

export type StreamJsonResult =
  | { ok: true; text: string; model: string; firstTokenMs: number | null; totalMs: number; usage: { input: number; output: number } }
  | { ok: false; reason: 'NOT_CONFIGURED' | 'TIMEOUT' | 'ABORTED' | 'PROVIDER_ERROR' | 'BUDGET_EXCEEDED' | 'TRUNCATED' | 'REFUSAL'; detail?: string; text: string; firstTokenMs: number | null; totalMs: number };

let anthropic: Anthropic | null = null;

/** Reads a text/event-stream body and yields each `data:` payload. */
async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      if (line.startsWith('data:')) yield line.slice(5).trimStart();
    }
  }
  if (buf.startsWith('data:')) yield buf.slice(5).trimStart();
}

async function compatStream(p: StreamJsonParams, signal: AbortSignal, started: number) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (env.llmApiKey) headers.authorization = `Bearer ${env.llmApiKey}`;
  // The GreekOS local server schedules by operation: a learner's turn pre-empts a warm-up of the same
  // conversation and never waits behind phrase feedback. Other servers ignore the header.
  if (isLocalLlm()) headers['x-greekos-operation'] = p.operation;
  let text = '';
  let first: number | null = null;
  let finish: string | null = null;
  let model = p.model ?? env.llmCompatModel;
  let usage = { input: 0, output: 0 };
  const res = await fetch(`${env.llmBaseUrl!.replace(/\/$/, '')}/v1/chat/completions`, {
    method: 'POST', headers, signal,
    body: JSON.stringify({
      model: p.model ?? env.llmCompatModel, stream: true, stream_options: { include_usage: true },
      max_tokens: p.maxTokens, temperature: p.temperature ?? 0.5, user: p.cacheKey,
      messages: [{ role: 'system', content: p.system }, ...p.messages],
      response_format: { type: 'json_schema', json_schema: { name: 'turn', strict: true, schema: p.schema } },
    }),
  });
  if (!res.ok || !res.body) throw Object.assign(new Error(`HTTP ${res.status}`), { provider: true });
  for await (const data of sseData(res.body)) {
    if (data === '[DONE]') break;
    let j: { model?: string; choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    try { j = JSON.parse(data); } catch { continue; }
    if (j.model) model = j.model;
    if (j.usage) usage = { input: j.usage.prompt_tokens ?? 0, output: j.usage.completion_tokens ?? 0 };
    const c = j.choices?.[0];
    if (c?.delta?.content) {
      first ??= Date.now() - started;
      text += c.delta.content;
      p.onText?.(c.delta.content);
    }
    if (c?.finish_reason) finish = c.finish_reason;
  }
  return { text, first, model, usage, truncated: finish === 'length', refusal: false };
}

async function anthropicStream(p: StreamJsonParams, signal: AbortSignal, started: number) {
  if (!env.anthropicKey) throw Object.assign(new Error('no key'), { provider: true });
  anthropic ??= new Anthropic({ apiKey: env.anthropicKey, maxRetries: 1 });
  let text = '';
  let first: number | null = null;
  let stop: string | null = null;
  let model = p.model ?? env.llmModelDialogue;
  const usage = { input: 0, output: 0 };
  const stream = await anthropic.beta.messages.create({
    model,
    // Current Claude models always think (adaptive) and thinking counts against max_tokens; the
    // local cap bounds CPU time and is too small for it. The reply's length is set by the prompt
    // and the schema; the turn's timeout still applies.
    max_tokens: Math.max(p.maxTokens, 4096), stream: true,
    // A safety-classifier decline (not expected for language practice) continues on the fallback
    // model in the same stream instead of ending the learner's turn.
    betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
    // The scene's system prompt and the earlier turns are the same prefix on every turn.
    cache_control: { type: 'ephemeral' },
    system: p.system, messages: p.messages,
    output_config: { format: { type: 'json_schema', schema: p.schema }, effort: p.effort ?? 'low' },
  }, { signal, timeout: p.timeoutMs });
  for await (const ev of stream) {
    // After a fallback the stream goes on with the fallback model: text before and after the
    // boundary is one continuous reply (the fallback model continues from the partial text).
    if (ev.type === 'message_start') { model = ev.message.model; usage.input = (ev.message.usage?.input_tokens ?? 0) + (ev.message.usage?.cache_read_input_tokens ?? 0) + (ev.message.usage?.cache_creation_input_tokens ?? 0); }
    else if (ev.type === 'content_block_start' && (ev.content_block as { type: string; to?: { model?: string } }).type === 'fallback') { model = (ev.content_block as { to?: { model?: string } }).to?.model ?? model; }
    else if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
      first ??= Date.now() - started;
      text += ev.delta.text;
      p.onText?.(ev.delta.text);
    } else if (ev.type === 'message_delta') {
      stop = ev.delta.stop_reason ?? stop;
      usage.output = ev.usage?.output_tokens ?? usage.output;
    }
  }
  return { text, first, model, usage, truncated: stop === 'max_tokens', refusal: stop === 'refusal' };
}

export async function streamJson(p: StreamJsonParams): Promise<StreamJsonResult> {
  const started = Date.now();
  if (!llmConfigured()) return { ok: false, reason: 'NOT_CONFIGURED', text: '', firstTokenMs: null, totalMs: 0 };
  try { await assertBudget(p.userId); } catch (e) { return { ok: false, reason: 'BUDGET_EXCEEDED', detail: (e as Error).message, text: '', firstTokenMs: null, totalMs: 0 }; }
  const timeout = AbortSignal.timeout(p.timeoutMs);
  const signal = p.signal ? AbortSignal.any([p.signal, timeout]) : timeout;
  const anth = env.llmProvider === 'anthropic';
  let partial = '';
  let firstMs: number | null = null;
  const onText = p.onText;
  const params = { ...p, onText: (c: string) => { firstMs ??= Date.now() - started; partial += c; onText?.(c); } };
  let ok = false;
  let usage = { input: 0, output: 0 };
  try {
    const r = anth ? await anthropicStream(params, signal, started) : await compatStream(params, signal, started);
    usage = r.usage;
    const totalMs = Date.now() - started;
    if (r.refusal) return { ok: false, reason: 'REFUSAL', text: r.text, firstTokenMs: r.first, totalMs };
    if (r.truncated) return { ok: false, reason: 'TRUNCATED', text: r.text, firstTokenMs: r.first, totalMs };
    ok = true;
    return { ok: true, text: r.text, model: r.model, firstTokenMs: r.first, totalMs, usage };
  } catch (e) {
    const totalMs = Date.now() - started;
    if (p.signal?.aborted) return { ok: false, reason: 'ABORTED', text: partial, firstTokenMs: firstMs, totalMs };
    if (timeout.aborted) return { ok: false, reason: 'TIMEOUT', text: partial, firstTokenMs: firstMs, totalMs };
    return { ok: false, reason: 'PROVIDER_ERROR', detail: (e as Error)?.message?.slice(0, 200), text: partial, firstTokenMs: firstMs, totalMs };
  } finally {
    const local = !anth && isLocalLlm();
    await recordUsage({
      userId: p.userId, provider: anth ? 'anthropic' : local ? 'local_llm' : 'openai_compatible', operation: p.operation,
      units: usage.input + usage.output, unitKind: 'tokens',
      costUsd: anth ? usage.input * COST.llmPerInputToken + usage.output * COST.llmPerOutputToken : 0,
      ok, latencyMs: Date.now() - started,
    }).catch(() => undefined);
  }
}
