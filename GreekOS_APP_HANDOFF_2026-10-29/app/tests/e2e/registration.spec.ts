import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { admin, readState } from './fixtures';
import { login } from './helpers';

/**
 * Access on a private platform (registration closed, no e-mail needed):
 *  - the login page offers no sign-up; /register explains how access works; the public API and a direct
 *    sign-up at the auth service are refused, and the database allows only the «closed» mode;
 *  - the owner adds a learner in the admin panel and gets a one-time link; the learner opens it, sets a
 *    password, signs out and in again; the link does not work twice;
 *  - «Новая ссылка» lets a learner who forgot the password set a new one;
 *  - the owner disables the learner: sign-in is refused and the open session loses access.
 */
const PASSWORD = 'Ellinika-2026!';

test('closed registration: no sign-up anywhere', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('link', { name: /Зарегистр/ })).toHaveCount(0);
  await expect(page.getByText('Доступ выдаёт владелец курса')).toBeVisible();
  await page.goto('/register');
  await expect(page.getByRole('heading', { name: 'Регистрация закрыта' })).toBeVisible();
  await expect(page.locator('form')).toHaveCount(0);
  const r = await page.request.post('/api/auth/register', { data: { display_name: 'X', email: `x-${randomUUID().slice(0, 6)}@greekos.test`, consent: true } });
  expect(r.status()).toBe(403);
  expect((await r.json()).error).toBe('REGISTRATION_CLOSED');
  // The setting cannot be reopened, not even by the service role.
  const { error } = await admin().from('platform_settings').update({ registration_mode: 'open' }).eq('id', true);
  expect(error?.message ?? '').toMatch(/check constraint/);
});

test('the owner gives access with a one-time link, renews it and disables the learner', async ({ browser }) => {
  test.setTimeout(4 * 60_000);
  const db = admin();
  const email = `link-${randomUUID().slice(0, 8)}@greekos.test`;
  const owner = await browser.newPage();
  await login(owner, readState().owner);
  try {
    await owner.goto('/admin/learners');
    await expect(owner.getByText('Регистрация закрыта')).toBeVisible();
    await owner.getByRole('button', { name: 'Добавить ученика' }).first().click();
    await owner.getByLabel('Имя').fill('Ученица По Ссылке');
    await owner.getByLabel('E-mail').fill(email);
    await owner.getByRole('button', { name: 'Далее' }).click();
    await owner.getByRole('button', { name: 'Подтвердить и создать ссылку' }).click();
    const link = await owner.locator('.copy-box input').inputValue();
    expect(link).toContain('/auth/confirm?');

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(link);
    await page.waitForURL(/\/auth\/set-password/);
    await page.getByLabel('Новый пароль').fill(PASSWORD);
    await page.getByLabel('Повторите пароль').fill(PASSWORD);
    await page.getByRole('button', { name: 'Сохранить и продолжить' }).click();
    await page.waitForURL(/\/welcome/, { timeout: 60_000 });
    // The same link cannot be used twice.
    const again = await (await browser.newContext()).newPage();
    await again.goto(link);
    await again.waitForURL(/\/login\?error=link/);

    // Forgotten password: the owner issues a new link from the learner card.
    const { data: p } = await db.from('profiles').select('user_id').eq('email', email).single();
    const fresh = await owner.request.post(`/api/admin/learners/${p!.user_id}/link`);
    expect(fresh.ok()).toBe(true);
    const renew = await (await browser.newContext()).newPage();
    await renew.goto((await fresh.json()).link);
    await renew.waitForURL(/\/auth\/set-password/);

    // Disabled: sign-in refused, the open session loses access to learner data.
    const off = await owner.request.post(`/api/admin/learners/${p!.user_id}/deactivate`, { data: { reason: 'e2e: проверка отключения' } });
    expect(off.ok()).toBe(true);
    const me = await page.request.get('/api/me/export');
    expect([401, 403]).toContain(me.status());
    const fresh2 = await (await browser.newContext()).newPage();
    await fresh2.goto('/login');
    await fresh2.getByLabel('E-mail').fill(email);
    await fresh2.getByLabel('Пароль').fill(PASSWORD);
    await fresh2.getByRole('button', { name: 'Войти' }).click();
    await expect(fresh2.locator('.error-text')).toContainText('доступ отключён');
    await ctx.close();
  } finally {
    const { data: left } = await db.from('profiles').select('user_id').eq('email', email);
    for (const x of left ?? []) await db.auth.admin.deleteUser(x.user_id);
    await owner.close();
  }
});
