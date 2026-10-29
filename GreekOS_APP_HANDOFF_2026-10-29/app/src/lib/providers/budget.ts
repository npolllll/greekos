import { adminClient } from '../supabase/admin.ts';
import { env } from '../env.ts';

export class BudgetExceededError extends Error {
  readonly code = 'BUDGET_EXCEEDED';
}

/** Rough per-operation cost estimates (USD) used only for guard rails, never billing. */
export const COST = {
  llmPerInputToken: 4 / 1_000_000,
  llmPerOutputToken: 20 / 1_000_000,
  asrPerSecond: 0.006 / 60,
  ttsPerChar: 15 / 1_000_000,
};

export async function assertBudget(userId: string | null) {
  const db = adminClient();
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const [{ data: day }, { data: month }] = await Promise.all([
    userId ? db.from('provider_usage').select('estimated_cost_usd').eq('user_id', userId).gte('created_at', since) : Promise.resolve({ data: [] as Array<{ estimated_cost_usd: number }> }),
    db.from('provider_usage').select('estimated_cost_usd').gte('created_at', monthStart),
  ]);
  const sum = (rows: Array<{ estimated_cost_usd: number | string }> | null) => (rows ?? []).reduce((a, r) => a + Number(r.estimated_cost_usd), 0);
  if (userId && sum(day) >= env.dailyUserBudgetUsd) throw new BudgetExceededError('Дневной лимит AI/голосовых операций исчерпан. Попробуйте завтра.');
  if (sum(month) >= env.monthlyBudgetUsd) throw new BudgetExceededError('Месячный лимит расходов на провайдеров исчерпан. Владелец может изменить лимит.');
}

export async function recordUsage(r: { userId: string | null; provider: string; operation: string; units: number; unitKind: string; costUsd: number; ok: boolean; latencyMs: number }) {
  await adminClient().from('provider_usage').insert({
    user_id: r.userId, provider: r.provider, operation: r.operation, units: r.units, unit_kind: r.unitKind,
    estimated_cost_usd: Number(r.costUsd.toFixed(6)), ok: r.ok, latency_ms: Math.round(r.latencyMs),
  });
}
