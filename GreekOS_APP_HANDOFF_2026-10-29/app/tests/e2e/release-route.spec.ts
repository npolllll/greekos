import { test, expect, type Page } from '@playwright/test';
import { rmSync } from 'node:fs';
import { admin, makeUser, readState } from './fixtures';
import { login } from './helpers';
import { POLICY_RISKS } from '../../src/lib/admin/labels';

/**
 * The main acceptance path on the real corpus, without any preview grant: the owner runs digital QA,
 * reviews the sample and releases a scope (the diagnostic probes and level A2) through the same API
 * the admin screens use; an experienced learner then registers their experience, takes the
 * diagnostic (A1 answers right, harder ones wrong), gets an individual route (A2), opens the first
 * A2 lesson from the route and gets verdicts on real released items.
 *
 * Everything the test creates is removed afterwards: the decision and its releases, the QA batch
 * with its sample, the learner, and — only if the test had to sign one — the policy fixture
 * (the owner's real policy, if any, is never touched).
 */

interface Probe { item_id: string; level: string; type: string; prompt: string; answer: string[] }

async function probes(): Promise<Probe[]> {
  const { data } = await admin().from('items').select('item_id, level, item_type, envelope').eq('pool', 'diagnostic_holdout');
  return (data ?? []).map((r) => ({ item_id: r.item_id, level: r.level, type: r.item_type, prompt: String(r.envelope.prompt ?? '').trim(), answer: (r.envelope.answer ?? []) as string[] }));
}

/** Answers the current probe: right at A1, deliberately wrong above; skills needing voice or a written text are skipped. */
async function answerProbe(page: Page, list: Probe[]): Promise<{ result: 'answered' | 'skipped' | 'done'; title: string }> {
  const title = page.locator('.placement-panel h2.placement-title');
  // A probe screen (or the end of probes) is shown and no request is in flight.
  await expect(page.locator('.placement-panel .tag').filter({ hasText: 'проба' }).or(page.getByRole('button', { name: 'Показать результат' }))).toBeVisible();
  await expect(page.getByRole('button', { name: 'Сохраняю…' })).toHaveCount(0);
  const text = (await title.innerText()).trim();
  if (text === 'Пробы закончились') return { result: 'done', title: text };
  const probe = list.find((p) => p.prompt === text || p.prompt.startsWith(text) || text.startsWith(p.prompt.slice(0, 40)));
  const right = probe?.level === 'A1';
  const radios = page.locator('.placement-panel [role="radiogroup"] [role="radio"]');
  const field = page.locator('.placement-panel input.greek-input');
  if (await radios.count()) {
    const want = right ? probe!.answer[0] : null;
    const options = await radios.allInnerTexts();
    const idx = want ? options.findIndex((o) => o.trim() === want) : options.findIndex((o) => !probe?.answer.includes(o.trim()));
    await radios.nth(Math.max(0, idx)).click();
  } else if (await field.count()) {
    await field.fill(right ? probe!.answer[0] : 'δεν ξέρω');
  } else {
    await page.getByRole('button', { name: /Пропустить навык|Дальше/ }).first().click();
    return { result: 'skipped', title: text };
  }
  await page.getByRole('button', { name: 'Ответить' }).click();
  return { result: 'answered', title: text };
}

test('owner releases a scope; an experienced learner without preview is placed by the diagnostic and studies the route', async ({ browser }) => {
  test.setTimeout(10 * 60_000);
  const db = admin();
  const created: { policy: string | null; batch: string | null; decision: string | null; report: string | null } = { policy: null, batch: null, decision: null, report: null };
  const learner = await makeUser('learner', false);
  const owner = await browser.newPage();
  await login(owner, readState().owner);
  try {
    // ---- Owner: policy, digital QA, sample review, release decision (admin API) ----
    const { data: active } = await db.from('publication_policies').select('id').is('revoked_at', null).limit(1).maybeSingle();
    if (!active) {
      const r = await owner.request.post('/api/admin/policy', { data: { acknowledged: POLICY_RISKS.map((x) => x.id), confirm_text: 'ПРИНИМАЮ РИСК' } });
      expect(r.ok(), await r.text()).toBe(true);
      created.policy = (await r.json()).policy_id;
    }
    const qa = await owner.request.post('/api/admin/qa/batches', { data: { label: 'E2E: выпуск и маршрут' }, timeout: 180_000 });
    expect(qa.ok(), await qa.text()).toBe(true);
    const qaRes = (await qa.json()) as { batch_id: string; report_path?: string };
    created.batch = qaRes.batch_id;
    created.report = qaRes.report_path ?? null;

    const diag = (await probes()).map((p) => p.item_id);
    const { data: a2 } = await db.from('items').select('item_id').eq('module', 'core').eq('level', 'A2');
    // The sample is a deterministic subset of the scope; the owner marks every reviewed item OK.
    for (const id of [...diag, ...(a2 ?? []).map((x) => x.item_id)]) {
      const r = await owner.request.post('/api/admin/qa/sample', { data: { batch_id: created.batch, item_id: id, decision: 'OK' } });
      expect(r.ok()).toBe(true);
    }
    const decide = async (scope: Record<string, unknown>) => {
      const r = await owner.request.post('/api/admin/qa/decision', { data: { batch_id: created.batch, scope, risk_acceptance: 'PASS_ONLY', note: 'E2E', confirm: true }, timeout: 120_000 });
      expect(r.ok(), await r.text()).toBe(true);
      return (await r.json()) as { decision_id: string; released: number };
    };
    const d1 = await decide({ kind: 'items', ids: diag });
    const d2 = await decide({ kind: 'level', level: 'A2' });
    created.decision = d1.decision_id;
    const decisions = [d1.decision_id, d2.decision_id];
    expect(d1.released + d2.released).toBeGreaterThan(100);

    // ---- Learner: experience → diagnostic → individual route → lesson ----
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, learner);
    await page.waitForURL(/\/welcome/);
    await page.getByRole('radio', { name: /Уже изучал/ }).click();
    await page.getByRole('button', { name: 'Начать' }).click();
    await page.waitForURL(/\/diagnostic/, { timeout: 30_000 });
    await page.getByRole('button', { name: 'Начать диагностику' }).click();
    const list = await probes();
    let answered = 0;
    for (let i = 0; i < 40; i++) {
      const r = await answerProbe(page, list);
      if (r.result === 'done') break;
      if (r.result === 'answered') answered++;
      // Wait for the next screen (a different probe, or the end of probes).
      await expect(page.locator('.placement-panel h2.placement-title')).not.toHaveText(r.title, { timeout: 60_000 });
    }
    expect(answered).toBeGreaterThanOrEqual(6); // grammar, vocabulary, reading: A1 right + A2 wrong
    await page.getByRole('button', { name: 'Показать результат' }).click();
    await expect(page.getByRole('heading', { name: 'Результат диагностики' })).toBeVisible();
    await expect(page.locator('.placement-panel h2')).toHaveText('A2 · ориентир');
    const { data: route } = await db.from('learning_routes').select('route_kind, start_unit_id').eq('user_id', learner.id).single();
    expect(route).toEqual({ route_kind: 'provisional', start_unit_id: 'U-A2-001' });

    await page.getByRole('link', { name: /Открыть маршрут/ }).click();
    await page.waitForURL(/\/course/);
    await page.goto(new URL('/lesson/U-A2-001', page.url()).toString());
    await page.getByRole('tab', { name: /Практика/ }).click();
    const player = page.locator('.player').first();
    await expect(player).toBeVisible({ timeout: 30_000 });
    const radios = player.locator('[role="radiogroup"] [role="radio"]');
    if (await radios.count()) await radios.first().click();
    else await player.locator('textarea.greek-input, input.greek-input').first().fill('Δεν ξέρω ακόμα.');
    await player.getByRole('button', { name: 'Проверить' }).click();
    await expect(player.locator('.verdict')).toBeVisible({ timeout: 120_000 });
    const { count } = await db.from('attempts').select('attempt_id', { count: 'exact', head: true }).eq('user_id', learner.id);
    expect(count ?? 0).toBeGreaterThan(answered); // diagnostic probes + the lesson answer, stored for this learner
    await page.goto(new URL('/progress', page.url()).toString());
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await ctx.close();

    for (const id of decisions) await db.from('content_releases').delete().eq('decision_id', id);
    await db.from('release_decisions').delete().in('id', decisions);
    created.decision = null;
  } finally {
    if (created.decision) {
      const { data: ds } = await db.from('release_decisions').select('id').eq('batch_id', created.batch!);
      const ids = (ds ?? []).map((d) => d.id);
      if (ids.length) { await db.from('content_releases').delete().in('decision_id', ids); await db.from('release_decisions').delete().in('id', ids); }
    }
    if (created.batch) {
      const { data: ds } = await db.from('release_decisions').select('id').eq('batch_id', created.batch);
      const ids = (ds ?? []).map((d) => d.id);
      if (ids.length) { await db.from('content_releases').delete().in('decision_id', ids); await db.from('release_decisions').delete().in('id', ids); }
      await db.from('qa_batches').delete().eq('id', created.batch);
    }
    if (created.policy) await db.from('publication_policies').delete().eq('id', created.policy);
    // The batch's report files (written by the app server next to the real QA reports).
    if (created.report) for (const f of [created.report, created.report.replace(/\.json$/, '.md')]) rmSync(f, { force: true });
    await db.auth.admin.deleteUser(learner.id);
    await owner.close();
  }
});
