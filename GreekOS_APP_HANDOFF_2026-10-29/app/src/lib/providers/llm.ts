import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { toJSONSchema, type z } from 'zod';
import { env } from '../env.ts';
import { assertBudget, COST, recordUsage } from './budget.ts';

let client: Anthropic | null = null;

/** A localhost endpoint is a development engine (never used outside APP_ENV=local|test). */
function isLocalUrl(u: string | undefined): boolean {
  return !!u && /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?/i.test(u);
}

export function llmConfigured(): boolean {
  if (env.llmProvider === 'anthropic') return !!env.anthropicKey;
  if (env.llmProvider === 'openai_compatible') return !!env.llmBaseUrl && (!isLocalUrl(env.llmBaseUrl) || env.localEnginesAllowed);
  return false;
}

/** What the UI must say about the dialogue/assessor engine (never claims validated quality). */
export function llmInfo(): { provider: string; model: string | null; local: boolean; label_ru: string } {
  if (!llmConfigured()) return { provider: 'none', model: null, local: false, label_ru: 'AI-модель не подключена — сценарный режим без оценки' };
  if (env.llmProvider === 'anthropic') return { provider: 'anthropic', model: env.llmModelDialogue, local: false, label_ru: `Claude (${env.llmModelDialogue})` };
  const local = isLocalUrl(env.llmBaseUrl);
  return { provider: 'openai_compatible', model: env.llmCompatModel, local, label_ru: local ? `Локальная модель ${env.llmCompatModel} (разработка; качество греческого не валидировано)` : `Модель ${env.llmCompatModel}` };
}

/** OpenAI-compatible structured call: JSON Schema from zod → constrained JSON → zod validation. */
async function compatCall<S extends z.ZodType>(params: { system: string; user: string; schema: S; maxTokens: number; timeoutMs: number }): Promise<StructuredResult<z.infer<S>> & { usage?: { input: number; output: number } }> {
  const schema = toJSONSchema(params.schema, { target: 'draft-7' }) as Record<string, unknown>;
  delete schema.$schema;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (env.llmApiKey) headers.authorization = `Bearer ${env.llmApiKey}`;
  let res: Response;
  try {
    res = await fetch(`${env.llmBaseUrl!.replace(/\/$/, '')}/v1/chat/completions`, {
      method: 'POST', headers, signal: AbortSignal.timeout(params.timeoutMs),
      body: JSON.stringify({ model: env.llmCompatModel, max_tokens: Math.min(params.maxTokens, isLocalUrl(env.llmBaseUrl) ? 400 : params.maxTokens), temperature: 0.4, messages: [{ role: 'system', content: params.system }, { role: 'user', content: params.user }], response_format: { type: 'json_schema', json_schema: { name: 'result', strict: true, schema } } }),
    });
  } catch (e) {
    return (e as Error)?.name === 'TimeoutError' ? { ok: false, reason: 'TIMEOUT' } : { ok: false, reason: 'PROVIDER_ERROR', detail: (e as Error)?.message?.slice(0, 200) };
  }
  if (!res.ok) return { ok: false, reason: 'PROVIDER_ERROR', detail: `${res.status}` };
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string }; finish_reason?: string }>; model?: string; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  const choice = json.choices?.[0];
  if (choice?.finish_reason === 'length') return { ok: false, reason: 'TRUNCATED' };
  let parsed: unknown;
  try { parsed = JSON.parse(choice?.message?.content ?? ''); } catch { return { ok: false, reason: 'INVALID_OUTPUT' }; }
  const checked = params.schema.safeParse(parsed);
  if (!checked.success) return { ok: false, reason: 'INVALID_OUTPUT', detail: checked.error.message.slice(0, 300) };
  return { ok: true, data: checked.data, model: json.model ?? env.llmCompatModel, usage: { input: json.usage?.prompt_tokens ?? 0, output: json.usage?.completion_tokens ?? 0 } };
}

function getClient(): Anthropic {
  if (!env.anthropicKey) throw new Error('LLM provider is not configured');
  client ??= new Anthropic({ apiKey: env.anthropicKey, maxRetries: 2 });
  return client;
}

export type StructuredResult<T> =
  | { ok: true; data: T; model: string }
  | { ok: false; reason: 'NOT_CONFIGURED' | 'REFUSAL' | 'INVALID_OUTPUT' | 'TIMEOUT' | 'PROVIDER_ERROR' | 'BUDGET_EXCEEDED' | 'TRUNCATED'; detail?: string };

/**
 * One schema-constrained Claude call. Any failure (refusal, truncation, parse failure, network)
 * is returned as a typed reason so callers ABSTAIN instead of inventing a result.
 */
export async function structuredCall<S extends z.ZodType>(params: {
  userId: string | null;
  operation: string;
  model: string;
  system: string;
  user: string;
  schema: S;
  effort: 'low' | 'medium' | 'high';
  maxTokens: number;
  timeoutMs: number;
}): Promise<StructuredResult<z.infer<S>>> {
  if (!llmConfigured()) return { ok: false, reason: 'NOT_CONFIGURED' };
  try {
    await assertBudget(params.userId);
  } catch (e) {
    return { ok: false, reason: 'BUDGET_EXCEEDED', detail: (e as Error).message };
  }
  const started = Date.now();
  let ok = false;
  let usage = { input_tokens: 0, output_tokens: 0 };
  if (env.llmProvider === 'openai_compatible') {
    const r = await compatCall(params);
    ok = r.ok;
    const local = isLocalUrl(env.llmBaseUrl);
    await recordUsage({ userId: params.userId, provider: local ? 'local_llm' : 'openai_compatible', operation: params.operation, units: (r.ok ? (r.usage?.input ?? 0) + (r.usage?.output ?? 0) : 0), unitKind: 'tokens', costUsd: 0, ok, latencyMs: Date.now() - started }).catch(() => undefined);
    if (!r.ok) return r;
    return { ok: true, data: r.data, model: r.model };
  }
  try {
    const response = await getClient().beta.messages.parse(
      {
        model: params.model,
        max_tokens: params.maxTokens,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        cache_control: { type: 'ephemeral' },
        system: params.system,
        messages: [{ role: 'user', content: params.user }],
        output_config: { format: betaZodOutputFormat(params.schema), effort: params.effort },
      },
      { timeout: params.timeoutMs },
    );
    usage = { input_tokens: response.usage.input_tokens ?? 0, output_tokens: response.usage.output_tokens ?? 0 };
    if (response.stop_reason === 'refusal') return { ok: false, reason: 'REFUSAL' };
    if (response.stop_reason === 'max_tokens') return { ok: false, reason: 'TRUNCATED' };
    if (!response.parsed_output) return { ok: false, reason: 'INVALID_OUTPUT' };
    const checked = params.schema.safeParse(response.parsed_output);
    if (!checked.success) return { ok: false, reason: 'INVALID_OUTPUT', detail: checked.error.message.slice(0, 300) };
    ok = true;
    return { ok: true, data: checked.data, model: response.model };
  } catch (e) {
    if (e instanceof Anthropic.APIConnectionTimeoutError) return { ok: false, reason: 'TIMEOUT' };
    if (e instanceof Anthropic.APIError) return { ok: false, reason: 'PROVIDER_ERROR', detail: `${e.status ?? ''} ${e.name}` };
    if (e instanceof SyntaxError || (e as Error)?.name === 'ZodError') return { ok: false, reason: 'INVALID_OUTPUT' };
    return { ok: false, reason: 'PROVIDER_ERROR', detail: (e as Error)?.message?.slice(0, 200) };
  } finally {
    await recordUsage({
      userId: params.userId, provider: 'anthropic', operation: params.operation,
      units: usage.input_tokens + usage.output_tokens, unitKind: 'tokens',
      costUsd: usage.input_tokens * COST.llmPerInputToken + usage.output_tokens * COST.llmPerOutputToken,
      ok, latencyMs: Date.now() - started,
    }).catch(() => undefined);
  }
}
