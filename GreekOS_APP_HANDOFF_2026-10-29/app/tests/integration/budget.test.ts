import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { admin } from './helpers';
import { reserve, settle, budgetPeriod, BudgetExceededError, llmCostUsd, llmEstimateUsd, usdToEur } from '@/lib/providers/budget';

/**
 * The owner's hard ceiling (10 €/month for everything): paid calls reserve their worst case
 * atomically before being sent, settle the actual cost after, and stop at the cap — under concurrent
 * learners, retries, failures and a new month. Test periods use a synthetic year so the real month's
 * ledger is untouched.
 */
const P = (m: number) => `1999-${String(m).padStart(2, '0')}`;
const rpc = (p: Record<string, unknown>) => admin.rpc('budget_reserve', p).then((r) => { if (r.error) throw r.error; return r.data as { ok: boolean; id?: string; reason?: string; replayed?: boolean }; });
const base = (period: string, amount: number, cap: number, key: string | null = null, user: string | null = null, dayCap: number | null = null) =>
  ({ p_period: period, p_user: user, p_provider: 'anthropic', p_operation: 'test', p_amount: amount, p_cap: cap, p_user_day_cap: dayCap, p_key: key });

afterAll(async () => { await admin.from('budget_ledger').delete().like('period', '1999-%'); });

describe('spending ceiling', () => {
  it('20 concurrent learners cannot overshoot the cap', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => rpc(base(P(1), 0.5, 3))));
    expect(results.filter((r) => r.ok)).toHaveLength(6);
    expect(results.filter((r) => !r.ok).every((r) => r.reason === 'MONTH_CAP')).toBe(true);
    const { data } = await admin.rpc('budget_committed', { p_period: P(1) });
    expect(Number(data)).toBeLessThanOrEqual(3);
  });

  it('a retried request with the same key is reserved once', async () => {
    const key = `retry-${randomUUID()}`;
    const [a, b] = await Promise.all([rpc(base(P(2), 1, 10, key)), rpc(base(P(2), 1, 10, key))]);
    expect(a.id).toBe(b.id);
    const { count } = await admin.from('budget_ledger').select('id', { count: 'exact', head: true }).eq('idempotency_key', key);
    expect(count).toBe(1);
  });

  it('settling frees the unused part; a failed call releases everything; a duplicate settle changes nothing', async () => {
    const a = await rpc(base(P(3), 2, 2));
    expect((await rpc(base(P(3), 0.5, 2))).ok).toBe(false);
    await admin.rpc('budget_settle', { p_id: a.id, p_actual: 0.25 });
    await admin.rpc('budget_settle', { p_id: a.id, p_actual: 1.9 });
    const { data } = await admin.rpc('budget_committed', { p_period: P(3) });
    expect(Number(data)).toBeCloseTo(0.25);
    const b = await rpc(base(P(3), 1, 2));
    await admin.rpc('budget_settle', { p_id: b.id, p_actual: 0 });
    const { data: row } = await admin.from('budget_ledger').select('status').eq('id', b.id).single();
    expect(row?.status).toBe('released');
  });

  it('a call that never settles (crash) keeps counting at its worst case', async () => {
    await rpc(base(P(4), 1.5, 2));
    expect((await rpc(base(P(4), 1, 2))).ok).toBe(false);
  });

  it('the cap is per month: a new month starts from zero', async () => {
    await rpc(base(P(5), 3, 3));
    expect((await rpc(base(P(5), 0.1, 3))).ok).toBe(false);
    expect((await rpc(base(P(6), 0.1, 3))).ok).toBe(true);
    expect(budgetPeriod(new Date(Date.UTC(2026, 11, 31, 23, 59)))).toBe('2026-12');
    expect(budgetPeriod(new Date(Date.UTC(2027, 0, 1, 0, 0)))).toBe('2027-01');
  });

  it('one learner cannot spend the whole month: per-learner daily cap', async () => {
    const { data: u } = await admin.auth.admin.createUser({ email: `synthetic-budget-${randomUUID().slice(0, 8)}@greekos.test`, email_confirm: true });
    try {
      expect((await rpc(base(P(7), 0.3, 10, null, u.user!.id, 0.5))).ok).toBe(true);
      const second = await rpc(base(P(7), 0.3, 10, null, u.user!.id, 0.5));
      expect(second).toMatchObject({ ok: false, reason: 'USER_DAY_CAP' });
    } finally {
      await admin.from('budget_ledger').delete().eq('user_id', u.user!.id);
      await admin.auth.admin.deleteUser(u.user!.id);
    }
  });

  it('the app layer blocks with a clear message and lets free calls through', async () => {
    expect((await reserve({ userId: null, provider: 'azure', operation: 'tts', estimateUsd: 0 })).id).toBeNull();
    // An estimate far above the whole monthly cap is refused before any request is sent.
    await expect(reserve({ userId: null, provider: 'anthropic', operation: 'test', estimateUsd: 1000 })).rejects.toBeInstanceOf(BudgetExceededError);
    const r = await reserve({ userId: null, provider: 'anthropic', operation: 'test', estimateUsd: 0.000001 });
    await settle(r, 0);
    const { data } = await admin.from('budget_ledger').select('status').eq('id', r.id!).single();
    expect(data?.status).toBe('released');
    await admin.from('budget_ledger').delete().eq('id', r.id!);
  });

  it('prices: Haiku 5.5 turn costs a fraction of a cent; the estimate is an upper bound; EUR conversion is conservative', () => {
    const turn = llmCostUsd('claude-haiku-5-5', { input: 300, cacheRead: 3000, output: 200 });
    expect(turn).toBeLessThan(0.0003);
    expect(llmEstimateUsd('claude-haiku-5-5', 9000, 4096)).toBeGreaterThan(turn);
    expect(llmCostUsd('unknown-model', { input: 1000, output: 0 })).toBeGreaterThan(llmCostUsd('claude-opus-5-5', { input: 1000, output: 0 }));
    expect(usdToEur(1)).toBeGreaterThanOrEqual(1.2);
  });
});
