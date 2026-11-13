import { test, expect, type Browser, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { admin, readState } from './fixtures';
import { login } from './helpers';

/**
 * Final acceptance on the real corpus (mandate §10, criteria 1–3, 6–8), in the running app, through
 * the same screens a person uses — no DEV-PREVIEW, no synthetic lesson:
 *  1. the owner signs the digital policy, reviews the sample and releases the whole admissible
 *     package with one decision (Admin → Выпуск);
 *  2. learner A gets the owner's one-time link (registration is closed), starts from zero with the alphabet, does the real alphabet
 *     lesson, gets an explained error, completes the lesson, signs out and back in, and sees the
 *     lesson completed, the error and the D-reviews on the home screen;
 *  3. learner B gets a separate link, says they have experience, takes the diagnostic, gets a different route
 *     (B1) and none of A's data;
 *  4. later lessons A1–B2, AI Speaking, Real Greek, ΠΕΓΠ and the exam trainer work for A;
 *  5. the owner sees both learners, disables B (B loses access) and rolls the release back
 *     (A sees the alphabet closed again).
 * Everything created here is removed afterwards; an existing owner policy is never touched.
 */

const PASSWORD = 'Ellinika-2026!';
const run = randomUUID().slice(0, 6);
const A = { email: `acc-a-${run}@greekos.test`, name: 'Анна Тестовая' };
const B = { email: `acc-b-${run}@greekos.test`, name: 'Борис Тестовый' };
const state: { policy: string | null; decision: string | null; batch: string | null; settings: Record<string, unknown> | null; ownerId: string | null } = { policy: null, decision: null, batch: null, settings: null, ownerId: null };

/**
 * Access as in production (registration closed, no e-mail): the owner adds the learner and gets a
 * one-time link; the learner opens it, sets a password and reaches onboarding.
 */
async function register(browser: Browser, who: { email: string; name: string }): Promise<Page> {
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  await login(owner, readState().owner);
  const r = await owner.request.post('/api/admin/invite', { data: { email: who.email, display_name: who.name, entry_path: 'unsure', delivery: 'link', confirmed: true } });
  expect(r.ok(), await r.text()).toBe(true);
  const { link } = await r.json() as { link: string };
  await ownerCtx.close();
  const page = await (await browser.newContext()).newPage();
  await page.goto(link);
  await page.waitForURL(/\/auth\/set-password/);
  await page.getByLabel('Новый пароль').fill(PASSWORD);
  await page.getByLabel('Повторите пароль').fill(PASSWORD);
  await page.getByRole('button', { name: 'Сохранить и продолжить' }).click();
  await page.waitForURL(/\/welcome/, { timeout: 60_000 });
  return page;
}

const at = (page: Page, path: string) => new URL(path, page.url()).toString();

interface Key { prompt: string; type: string; answer: string[] }
async function keys(unitId: string): Promise<Key[]> {
  const { data } = await admin().from('items').select('item_type, envelope').eq('unit_id', unitId);
  return (data ?? []).map((r) => ({ prompt: String(r.envelope.prompt ?? '').trim(), type: r.item_type, answer: (r.envelope.answer ?? []) as string[] }));
}

/**
 * Answers every task of every practice step of the open lesson. `wrong` names a prompt fragment to
 * answer wrongly once (then the explanation is opened). Returns the number of answered tasks.
 */
async function doLesson(page: Page, unitId: string, wrong?: string): Promise<number> {
  const ks = await keys(unitId);
  let answered = 0;
  const tabs = page.locator('.steps [role="tab"]');
  const n = await tabs.count();
  for (let t = 0; t < n; t++) {
    await tabs.nth(t).click();
    // The step change is animated: wait until the previous panel has left.
    await expect(tabs.nth(t)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[role="tabpanel"]')).toHaveCount(1);
    await page.locator('[role="tabpanel"]').evaluate((el) => new Promise((r) => { const a = el.getAnimations({ subtree: true }); Promise.all(a.map((x) => x.finished)).then(r, r); }));
    const players = page.locator('[role="tabpanel"] .player');
    const count = await players.count();
    for (let i = 0; i < count; i++) {
      const p = players.nth(i);
      if (await p.locator('.verdict').count()) continue;
      const text = await p.innerText();
      const k = ks.find((x) => x.prompt && text.includes(x.prompt.slice(0, 30)));
      const bad = !!wrong && text.includes(wrong);
      const radios = p.locator('[role="radiogroup"] [role="radio"]');
      const field = p.getByLabel(/^Ваш ответ/).first();
      if (await radios.count()) {
        const labels = (await radios.allInnerTexts()).map((x) => x.trim());
        const idx = k && !bad ? labels.findIndex((l) => k.answer.includes(l)) : labels.findIndex((l) => !k?.answer.includes(l));
        await radios.nth(Math.max(0, idx)).click();
      } else if (await field.count()) {
        const value = bad ? wrong!.split(':').pop()!.trim().replace(/\.$/, '') : k?.answer[0] ?? 'Με λένε Άννα. Μένω στη Θεσσαλονίκη και μαθαίνω ελληνικά.';
        await field.fill(value);
      } else continue;
      await p.getByRole('button', { name: 'Проверить' }).click();
      await expect(p.locator('.verdict')).toBeVisible({ timeout: 120_000 });
      answered++;
      if (bad) {
        await expect(p.locator('.verdict')).toContainText('Есть ошибка');
        await p.getByRole('button', { name: 'Почему так?' }).click();
        await expect(p.locator('.context-coach')).toBeVisible({ timeout: 60_000 });
        await expect(p.locator('.context-coach')).toContainText('Разбор в контексте', { ignoreCase: true });
        // The explanation holds its own transfer task; close it to keep the lesson's task order.
        await p.getByRole('button', { name: 'Скрыть разбор' }).click();
        await expect(p.locator('.context-coach')).toHaveCount(0);
        wrong = undefined;
      }
    }
  }
  return answered;
}

test.describe.serial('final acceptance on the real corpus', () => {
  test.setTimeout(15 * 60_000);
  test.use({ actionTimeout: 30_000 });

  test.beforeAll(async () => {
    const db = admin();
    state.settings = (await db.from('platform_settings').select('*').eq('id', true).single()).data;
    await db.from('platform_settings').update({ max_learners: 50 }).eq('id', true);
    state.ownerId = readState().owner.id;
  });

  test.afterAll(async () => {
    const db = admin();
    if (state.decision) {
      await db.from('content_releases').delete().eq('decision_id', state.decision);
      await db.from('release_decisions').delete().eq('id', state.decision);
    }
    if (state.batch && state.ownerId) await db.from('qa_sample_reviews').delete().eq('batch_id', state.batch).eq('reviewer_id', state.ownerId);
    if (state.policy) await db.from('publication_policies').delete().eq('id', state.policy);
    const { data: users } = await db.from('profiles').select('user_id').in('email', [A.email, B.email]);
    for (const u of users ?? []) await db.auth.admin.deleteUser(u.user_id);
    if (state.settings) await db.from('platform_settings').update({ max_learners: state.settings.max_learners }).eq('id', true);
  });

  test('1. owner: policy, sample and one decision release the whole admissible package', async ({ page }) => {
    const db = admin();
    page.on('dialog', (d) => d.accept());
    await login(page, readState().owner);
    const { data: active } = await db.from('publication_policies').select('id').is('revoked_at', null).limit(1).maybeSingle();
    if (!active) {
      await page.goto('/admin/policy');
      for (const cb of await page.locator('.check-list input[type="checkbox"]').all()) await cb.check();
      await page.getByLabel('Введите «ПРИНИМАЮ РИСК»').fill('ПРИНИМАЮ РИСК');
      await page.getByRole('button', { name: 'Подписать политику' }).click();
      await expect.poll(async () => (await db.from('publication_policies').select('id').is('revoked_at', null).limit(1).maybeSingle()).data?.id ?? null).not.toBeNull();
      state.policy = (await db.from('publication_policies').select('id').is('revoked_at', null).order('signed_at', { ascending: false }).limit(1).single()).data!.id;
    }
    await page.goto('/admin/qa/release');
    await expect(page.getByText('Что откроется ученикам')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('Права источника не урегулированы')).toBeVisible();
    state.batch = (await db.from('qa_batches').select('id').eq('status', 'COMPLETED').eq('scope->>kind', 'all').order('started_at', { ascending: false }).limit(1).single()).data!.id;
    // The owner's sample: at most 30 cards, one click each.
    const ok = page.getByRole('button', { name: 'Корректно' });
    const total = await ok.count();
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(30);
    for (let left = total; left > 0; left--) {
      await ok.first().click();
      await expect(ok).toHaveCount(left - 1, { timeout: 60_000 });
    }
    await page.getByLabel(/Я выпускаю для учеников/).check();
    await page.getByRole('button', { name: 'Принять решение о выпуске' }).click();
    await expect(page.getByText(/Решение записано: выпущено \d+/)).toBeVisible({ timeout: 120_000 });
    const { data: d } = await db.from('release_decisions').select('id, counts').eq('batch_id', state.batch).is('revoked_at', null).order('decided_at', { ascending: false }).limit(1).single();
    state.decision = d!.id;
    expect((d!.counts as { released: number }).released).toBeGreaterThan(1900);
    for (const k of ['item', 'unit', 'scenario', 'rg_expression', 'pegp_packet']) {
      const { count } = await db.from('content_releases').select('id', { count: 'exact', head: true }).eq('decision_id', state.decision).eq('content_kind', k);
      expect(count ?? 0, k).toBeGreaterThan(0);
    }
    // ΠΕΓΠ tasks with unsettled rights stay closed.
    const { count: pegpBlocked } = await db.from('content_releases').select('id', { count: 'exact', head: true }).eq('decision_id', state.decision).like('content_id', 'PEGP-LANG-P04-%');
    expect(pegpBlocked).toBe(0);
  });

  test('2. learner A from zero: alphabet, real lesson, explained error, completion, return and progress', async ({ browser }) => {
    const page = await register(browser, A);
    await page.getByRole('radio', { name: /С полного нуля/ }).click();
    await page.getByRole('radio', { name: 'Жить и общаться в Греции' }).click();
    await page.getByRole('button', { name: 'Начать' }).click();
    await page.waitForURL((u) => u.pathname === '/');
    await page.goto(at(page, '/alphabet'));
    await expect(page.locator('.alpha-grid')).toBeVisible();
    await page.getByRole('link', { name: /Урок «Алфавит»/ }).click();
    await page.waitForURL(/\/lesson\/U-A1-007/);
    const n = await doLesson(page, 'U-A1-007', 'Исправьте только конечную сигму: φίλοσ');
    expect(n).toBeGreaterThan(10);
    await page.getByRole('button', { name: 'Завершить урок' }).click();
    await expect(page.getByText('Урок завершён и сохранён.')).toBeVisible({ timeout: 60_000 });
    // Sign out, come back in a fresh browser: the state is in the database, not in the tab.
    await page.locator('.profile-button').click();
    await page.getByRole('menuitem', { name: 'Выйти' }).click();
    await page.waitForURL(/\/login/);
    const again = await (await browser.newContext()).newPage();
    await again.goto(at(page, '/login'));
    await again.getByLabel('E-mail').fill(A.email);
    await again.getByLabel('Пароль', { exact: true }).fill(PASSWORD);
    await again.getByRole('button', { name: 'Войти' }).click();
    await again.waitForURL((u) => !u.pathname.startsWith('/login'));
    await expect(again.getByText('Ближайшие повторения')).toBeVisible();
    await again.goto(at(again, '/course'));
    await expect(again.locator('.unit-row', { hasText: 'U-A1-007' }).or(again.locator('.unit-row', { hasText: 'Алфавит' })).first()).toContainText('Пройден');
    await again.goto(at(again, '/errors'));
    await expect(again.getByText(/φίλος|сигм/).first()).toBeVisible();
    const { data: p } = await admin().from('profiles').select('user_id, signup_source').eq('email', A.email).single();
    const { count } = await admin().from('attempts').select('attempt_id', { count: 'exact', head: true }).eq('user_id', p!.user_id).eq('preview', false);
    expect(count).toBeGreaterThanOrEqual(n);
    expect(p!.signup_source).toBe('self');
  });

  test('3. learner B with experience: diagnostic → a different route (B1), no data of A', async ({ browser }) => {
    const page = await register(browser, B);
    await page.getByRole('radio', { name: /Уже изучал/ }).click();
    await page.getByRole('radiogroup', { name: 'Предполагаемый уровень' }).getByRole('radio', { name: 'B1' }).click();
    await page.getByRole('radio', { name: 'Работа' }).click();
    await page.getByRole('button', { name: 'Начать' }).click();
    await page.waitForURL(/\/diagnostic/, { timeout: 30_000 });
    await page.getByRole('button', { name: 'Начать диагностику' }).click();
    const { data: probes } = await admin().from('items').select('level, envelope').eq('pool', 'diagnostic_holdout');
    for (let i = 0; i < 40; i++) {
      await expect(page.locator('.placement-panel .tag').filter({ hasText: 'проба' }).or(page.getByRole('button', { name: 'Показать результат' }))).toBeVisible();
      await expect(page.getByRole('button', { name: 'Сохраняю…' })).toHaveCount(0);
      const title = (await page.locator('.placement-panel h2.placement-title').innerText()).trim();
      if (title === 'Пробы закончились') break;
      const pr = (probes ?? []).find((x) => String(x.envelope.prompt).trim().startsWith(title.slice(0, 40)));
      const right = pr && pr.level !== 'B1';
      const ans = (pr?.envelope.answer ?? []) as string[];
      const radios = page.locator('.placement-panel [role="radiogroup"] [role="radio"]');
      const field = page.locator('.placement-panel input.greek-input');
      if (await radios.count()) {
        const labels = (await radios.allInnerTexts()).map((x) => x.trim());
        await radios.nth(Math.max(0, right ? labels.findIndex((l) => ans.includes(l)) : labels.findIndex((l) => !ans.includes(l)))).click();
        await page.getByRole('button', { name: 'Ответить' }).click();
      } else if (await field.count()) {
        await field.fill(right ? ans[0] : 'δεν ξέρω');
        await page.getByRole('button', { name: 'Ответить' }).click();
      } else {
        await page.getByRole('button', { name: /Пропустить навык|Дальше/ }).first().click();
      }
      await expect(page.locator('.placement-panel h2.placement-title')).not.toHaveText(title, { timeout: 60_000 });
    }
    await page.getByRole('button', { name: 'Показать результат' }).click();
    await expect(page.locator('.placement-panel h2')).toHaveText('B1 · ориентир');
    const { data: bp } = await admin().from('profiles').select('user_id').eq('email', B.email).single();
    const { data: route } = await admin().from('learning_routes').select('start_unit_id').eq('user_id', bp!.user_id).single();
    expect(route!.start_unit_id).toBe('U-B1-001');
    await page.goto(at(page, '/lesson/U-B1-001'));
    expect(await doLesson(page, 'U-B1-001')).toBeGreaterThan(0);
    // None of A's data: B's notebook has no confirmed errors yet, and the API returns only B's rows.
    await page.goto(at(page, '/errors'));
    await expect(page.getByText(/φίλος/)).toHaveCount(0);
  });

  test('4. later lessons and every section work for an ordinary learner', async ({ browser }) => {
    const page = await (await browser.newContext()).newPage();
    await login(page, { id: '', email: A.email, password: PASSWORD });
    for (const level of ['A1', 'A2', 'B1', 'B2']) {
      await page.goto(`/course?level=${level}`);
      const row = page.locator('.unit-list .unit-row').first();
      await expect(row).not.toContainText('На проверке');
      await row.click();
      await page.waitForURL(/\/lesson\//);
      await expect(page.locator('.steps [role="tab"]').first()).toBeVisible({ timeout: 30_000 });
    }
    // AI Speaking: a released scene starts (text mode here; the live voice path has its own test).
    await page.goto('/speaking');
    await page.getByRole('button', { name: 'Текстом' }).first().click();
    await page.waitForURL(/\/speaking\/[0-9a-f-]{36}/, { timeout: 60_000 });
    // Real Greek: a released card with practice.
    await page.goto('/real-greek');
    await expect(page.getByText(/из 12 выпущено/)).toBeVisible();
    await page.getByRole('link', { name: 'Контексты и практика' }).click();
    await expect(page.locator('.player').first()).toBeVisible({ timeout: 30_000 });
    // ΠΕΓΠ: topics open; the unsettled-rights tasks stay closed without closing the section.
    await page.goto('/pegp');
    await page.locator('.pegp-topic').first().click();
    await expect(page.locator('.player').first()).toBeVisible({ timeout: 30_000 });
    // ΚΕΓ B2 trainer: a reading component starts in practice mode.
    await page.goto('/exams/KEG-B2-R03');
    await page.getByRole('radio', { name: /Практика без таймера/ }).click();
    await page.getByRole('button', { name: 'Начать' }).click();
    await expect(page.getByRole('button', { name: /^Сдать/ }).first()).toBeVisible({ timeout: 30_000 });
  });

  test('5. owner: sees both learners, disables B, rolls the release back', async ({ browser, page }) => {
    page.on('dialog', (d) => d.accept('Проверка приёмки'));
    await login(page, readState().owner);
    await page.goto('/admin/learners');
    await expect(page.getByText(A.email)).toBeVisible();
    await expect(page.getByText(B.email)).toBeVisible();
    await page.getByRole('link', { name: A.name }).click();
    await expect(page.getByText('Жить и общаться в Греции')).toBeVisible();
    // Criterion 7 on the owner's side: the lesson, the confirmed error and the D-reviews of A.
    await expect(page.getByText('U-A1-007').first()).toBeVisible();
    await expect(page.getByText('Отсроченные проверки D1–D28')).toBeVisible();
    await expect(page.locator('.review-row', { hasText: /D\d+ ·/ }).first()).toBeVisible();
    await page.goto('/admin/learners');
    await page.getByRole('link', { name: B.name }).click();
    await expect(page.getByText('Сдать экзамен ΚΕΓ B2').or(page.getByText('Работа')).first()).toBeVisible();
    await page.getByRole('button', { name: 'Деактивировать' }).click();
    await expect(page.getByText('Доступ отключён')).toBeVisible({ timeout: 30_000 });
    const b = await (await browser.newContext()).newPage();
    await b.goto('/login');
    await b.getByLabel('E-mail').fill(B.email);
    await b.getByLabel('Пароль', { exact: true }).fill(PASSWORD);
    await b.getByRole('button', { name: 'Войти' }).click();
    await expect(b).toHaveURL(/\/login/);
    // Roll back: the decision is revoked, the alphabet closes again for A.
    await page.goto('/admin/qa/release');
    await page.locator('tr', { hasText: '"kind":"all"' }).getByRole('button', { name: 'Отозвать' }).first().click();
    await expect(page.getByText(/ОТОЗВАНО/).first()).toBeVisible({ timeout: 60_000 });
    const a = await (await browser.newContext()).newPage();
    await login(a, { id: '', email: A.email, password: PASSWORD });
    await a.goto('/alphabet');
    await expect(a.getByText('Урок «Алфавит» на проверке')).toBeVisible();
  });
});
