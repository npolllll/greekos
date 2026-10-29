import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';
import { env } from '../env.ts';
import { assertBudget, COST, recordUsage } from './budget.ts';

let client: Anthropic | null = null;

export function llmConfigured(): boolean {
  return !!env.anthropicKey;
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
