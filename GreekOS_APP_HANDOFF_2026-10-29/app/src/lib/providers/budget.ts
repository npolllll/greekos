/**
 * Hard spending ceiling for paid AI / speech APIs.
 *
 * Every paid call: reserve(worst-case cost) → provider call → settle(actual cost). A reservation is
 * granted atomically in the database (budget_reserve: a per-month advisory lock, an idempotency key
 * for retries) only while the month's settled + in-flight spend stays under the cap; otherwise the
 * call is not sent and the learner keeps everything that costs nothing (lessons, exercises, progress,
 * released audio). Prices are list prices converted to EUR with a conservative rate and a tax
 * multiplier; they are guard rails, not invoices — the provider's own limit is the second line.
 */
import { adminClient } from '../supabase/admin.ts';
import { env } from '../env.ts';

export class BudgetExceededError extends Error {
  readonly code = 'BUDGET_EXCEEDED';
}

/** USD per million tokens: input, output; cache writes 1.25× input, cache reads 0.1× input (Claude list prices). */
const MODEL_PRICES: Record<string, { in: number; out: number; cacheRead?: number }> = {
  'claude-haiku-5-5': { in: 0.10, out: 0.50 },
  'claude-sonnet-5-5': { in: 2, out: 10, cacheRead: 0.20 },
  'claude-sonnet-5': { in: 2, out: 10 },
  'claude-opus-5-5': { in: 4, out: 20, cacheRead: 0.20 },
  'claude-opus-5': { in: 5, out: 25 },
  'claude-fable-5-1': { in: 10, out: 50, cacheRead: 0.25 },
};
/** An unknown model is priced like the most expensive one: the guard errs on the safe side. */
const UNKNOWN_MODEL = { in: 10, out: 50 };

export function modelPrice(model: string) {
  const p = MODEL_PRICES[model] ?? Object.entries(MODEL_PRICES).find(([k]) => model.startsWith(k))?.[1] ?? UNKNOWN_MODEL;
  return { in: p.in, out: p.out, cacheWrite: p.in * 1.25, cacheRead: p.cacheRead ?? p.in * 0.1 };
}

export interface TokenUsage { input: number; output: number; cacheWrite?: number; cacheRead?: number }

export function llmCostUsd(model: string, u: TokenUsage): number {
  const p = modelPrice(model);
  return (u.input * p.in + u.output * p.out + (u.cacheWrite ?? 0) * p.cacheWrite + (u.cacheRead ?? 0) * p.cacheRead) / 1_000_000;
}

/** Worst case before sending: every prompt character a token (Greek/Russian run ~2–3 chars per token) and the full max_tokens. */
export function llmEstimateUsd(model: string, promptChars: number, maxTokens: number): number {
  return llmCostUsd(model, { input: 0, cacheWrite: Math.ceil(promptChars / 2), output: maxTokens });
}

/** Speech prices in USD. Azure's free tier (F0) cannot accrue charges; S0 is billed per use. */
export const speechPrice = {
  get ttsPerChar() {
    if (env.ttsProvider === 'azure' && env.azureSpeechTier === 'F0') return 0;
    return env.ttsProvider === 'azure' ? env.azureTtsUsdPerMillionChars / 1_000_000 : 15 / 1_000_000;
  },
  get asrPerSecond() {
    if (env.asrProvider === 'azure' && env.azureSpeechTier === 'F0') return 0;
    return env.asrProvider === 'azure' ? env.azureSttUsdPerHour / 3600 : 0.006 / 60;
  },
};
/** Kept for the audio planner's per-run estimate. */
export const COST = { get ttsPerChar() { return speechPrice.ttsPerChar; } };

export const usdToEur = (usd: number) => usd * env.budgetUsdToEur * env.budgetTaxMultiplier;

/** Billing month (UTC). The cap resets at 00:00 UTC on the 1st. */
export function budgetPeriod(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
export function nextReset(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}

/** Ceiling for paid API calls this month: (maximum − fixed infrastructure) × safety ratio. */
export function apiCapEur(): number {
  return Math.max(0, (env.budgetMonthlyEurMax - env.budgetFixedEur) * env.budgetSafetyRatio);
}

export interface Reservation { id: string | null; provider: string; operation: string; userId: string | null }

const FREE = (provider: string, operation: string, userId: string | null): Reservation => ({ id: null, provider, operation, userId });

/** Reserves the worst-case cost; throws BudgetExceededError if the cap would be crossed. Free calls pass. */
export async function reserve(o: { userId: string | null; provider: string; operation: string; estimateUsd: number; key?: string }): Promise<Reservation> {
  if (!(o.estimateUsd > 0)) return FREE(o.provider, o.operation, o.userId);
  const { data, error } = await adminClient().rpc('budget_reserve', {
    p_period: budgetPeriod(), p_user: o.userId, p_provider: o.provider, p_operation: o.operation,
    p_amount: Number(usdToEur(o.estimateUsd).toFixed(6)), p_cap: Number(apiCapEur().toFixed(6)),
    p_user_day_cap: env.budgetDailyEurPerUser, p_key: o.key ?? null,
  });
  // Fail closed: if the ledger cannot be reached, the paid call is not sent.
  if (error) throw new BudgetExceededError('Учёт расходов недоступен — платные AI-функции временно отключены. Уроки и упражнения работают как обычно.');
  const r = data as { ok: boolean; id?: string; reason?: string };
  if (!r.ok) {
    throw new BudgetExceededError(r.reason === 'USER_DAY_CAP'
      ? 'Дневной лимит AI-функций для вас исчерпан. Уроки, упражнения и готовое аудио работают; разговор с AI откроется завтра.'
      : 'Месячный бюджет AI-функций исчерпан. Уроки, упражнения, прогресс и готовое аудио работают как обычно; AI-разговор и AI-проверка вернутся в начале следующего месяца.');
  }
  return { id: r.id ?? null, provider: o.provider, operation: o.operation, userId: o.userId };
}

/** Records the actual cost (0 → released). Never throws: a failed settle leaves the worst case counted. */
export async function settle(r: Reservation, actualUsd: number | null): Promise<void> {
  if (!r.id) return;
  await Promise.resolve(adminClient().rpc('budget_settle', { p_id: r.id, p_actual: Number(usdToEur(Math.max(0, actualUsd ?? 0)).toFixed(6)) })).catch(() => undefined);
}

export async function recordUsage(r: { userId: string | null; provider: string; operation: string; units: number; unitKind: string; costUsd: number; ok: boolean; latencyMs: number }) {
  await adminClient().from('provider_usage').insert({
    user_id: r.userId, provider: r.provider, operation: r.operation, units: r.units, unit_kind: r.unitKind,
    estimated_cost_usd: Number(r.costUsd.toFixed(6)), ok: r.ok, latency_ms: Math.round(r.latencyMs),
  });
}

/** Owner view: this month's spend by service, remaining, reset date. */
export async function budgetSummary() {
  const period = budgetPeriod();
  const { data } = await adminClient().from('budget_ledger').select('provider, operation, status, reserved_eur, actual_eur').eq('period', period);
  const byProvider = new Map<string, number>();
  let committed = 0;
  let inFlight = 0;
  for (const r of data ?? []) {
    const v = r.status === 'settled' ? Number(r.actual_eur) : r.status === 'reserved' ? Number(r.reserved_eur) : 0;
    if (r.status === 'reserved') inFlight += 1;
    committed += v;
    byProvider.set(r.provider, (byProvider.get(r.provider) ?? 0) + v);
  }
  const cap = apiCapEur();
  return {
    period, committedEur: committed, inFlight, capEur: cap, remainingEur: Math.max(0, cap - committed),
    fixedEur: env.budgetFixedEur, maxEur: env.budgetMonthlyEurMax, targetEur: env.budgetMonthlyEurTarget,
    projectedTotalEur: committed + env.budgetFixedEur, resetsAt: nextReset().toISOString(),
    byProvider: [...byProvider.entries()].map(([provider, eur]) => ({ provider, eur })).sort((a, b) => b.eur - a.eur),
    blocked: committed >= cap,
  };
}
