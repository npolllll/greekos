import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { admin, readState } from './fixtures';
import { login } from './helpers';

/**
 * Self-registration end to end: the owner opens registration (by code) in the admin panel; a visitor
 * registers on /register, receives the e-mail (local Mailpit), opens the link, sets a password, goes
 * through onboarding «from zero» and lands on the alphabet route; a second visitor with a wrong code
 * is refused; when the seats are taken, registration says so. Settings are restored afterwards.
 */
// Local Mailpit of the Supabase stack (config.toml [inbucket] port), not the app's baseURL.
const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:55324';

async function linkFor(email: string): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`).then((x) => x.json()).catch(() => null);
    const id = r?.messages?.[0]?.ID;
    if (id) {
      const m = await fetch(`${MAILPIT}/api/v1/message/${id}`).then((x) => x.json());
      const href = /href="([^"]*\/auth\/confirm[^"]*)"/.exec(String(m.HTML).replace(/&amp;/g, '&'))?.[1];
      if (href) return href;
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  throw new Error(`no e-mail for ${email}`);
}

async function setRegistration(page: Page, mode: 'closed' | 'code' | 'open', seats: number, newCode = false): Promise<string | null> {
  const r = await page.request.post('/api/admin/registration', { data: { registration_mode: mode, max_learners: seats, new_code: newCode } });
  expect(r.ok()).toBe(true);
  return (await r.json()).code ?? null;
}

test('a visitor registers with the owner\'s code, confirms the e-mail and starts from the alphabet', async ({ browser }) => {
  test.setTimeout(4 * 60_000);
  const db = admin();
  const { data: before } = await db.from('platform_settings').select('*').eq('id', true).single();
  // The rate limit counts every attempt per address; a test run starts from a clean hour.
  await db.from('registration_attempts').delete().gte('created_at', new Date(Date.now() - 3_600_000).toISOString());
  const owner = await browser.newPage();
  await login(owner, readState().owner);
  await owner.goto('/admin/learners');
  await expect(owner.getByText('Регистрация учеников')).toBeVisible();
  const code = await setRegistration(owner, 'code', 50, true);
  expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  const email = `self-${randomUUID().slice(0, 8)}@greekos.test`;
  const created: string[] = [];
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto('/login');
    await page.getByRole('link', { name: 'Зарегистрироваться' }).click();
    await page.waitForURL(/\/register/);
    // A wrong code is refused with a clear message.
    await page.getByLabel('Как к вам обращаться').fill('Ученица Тест');
    await page.getByLabel('E-mail').fill(email);
    await page.getByLabel('Код регистрации').fill('WRONG-CODE');
    await page.locator('.consent-row input').check();
    await page.getByRole('button', { name: 'Получить письмо для входа' }).click();
    await expect(page.locator('.error-text')).toContainText('Код регистрации не подходит');
    await page.getByLabel('Код регистрации').fill(code!);
    await page.getByRole('button', { name: 'Получить письмо для входа' }).click();
    await expect(page.getByText('Проверьте почту.')).toBeVisible();

    await page.goto(await linkFor(email));
    await page.waitForURL(/\/auth\/set-password/);
    await page.getByLabel('Новый пароль').fill('Ellinika-2026!');
    await page.getByLabel('Повторите пароль').fill('Ellinika-2026!');
    await page.getByRole('button', { name: 'Сохранить и продолжить' }).click();
    await page.waitForURL(/\/welcome/, { timeout: 60_000 });
    await page.getByRole('radio', { name: /С полного нуля/ }).click();
    await page.getByRole('button', { name: 'Начать' }).click();
    await page.waitForURL((u) => u.pathname === '/');
    // Stay on the origin of the e-mail link (APP_URL): the session lives there.
    await page.goto(new URL('/course', page.url()).toString());
    await expect(page.locator('.unit-row').first()).toContainText('Алфавит');

    const { data: p } = await db.from('profiles').select('user_id, signup_source, lifecycle_state, active').eq('email', email).single();
    created.push(p!.user_id);
    expect(p).toMatchObject({ signup_source: 'self', active: true });
    // The owner sees the new learner, marked as self-registered.
    await owner.goto('/admin/learners');
    await expect(owner.getByText(email)).toBeVisible();
    await ctx.close();

    // No free seats: registration says so instead of sending an e-mail.
    const used = (await (await owner.request.get('/api/admin/registration')).json()).seats_used as number;
    await setRegistration(owner, 'open', used);
    const r = await owner.request.post('/api/auth/register', { data: { display_name: 'Ещё один', email: `self-${randomUUID().slice(0, 8)}@greekos.test`, consent: true } });
    expect(r.status()).toBe(409);
    expect((await r.json()).error).toBe('NO_SEATS');
  } finally {
    // Also when the test failed before the account id was recorded: find it by the address.
    const { data: left } = await db.from('profiles').select('user_id').eq('email', email);
    for (const id of new Set([...created, ...(left ?? []).map((x) => x.user_id)])) await db.auth.admin.deleteUser(id);
    await db.from('platform_settings').update({ registration_mode: before.registration_mode, registration_code_hash: before.registration_code_hash, max_learners: before.max_learners }).eq('id', true);
    await owner.close();
  }
});

test('closed registration: the login page offers no sign-up and the API refuses', async ({ page }) => {
  const db = admin();
  const { data: before } = await db.from('platform_settings').select('*').eq('id', true).single();
  await db.from('platform_settings').update({ registration_mode: 'closed' }).eq('id', true);
  try {
    await page.goto('/login');
    await expect(page.getByRole('link', { name: 'Зарегистрироваться' })).toHaveCount(0);
    const r = await page.request.post('/api/auth/register', { data: { display_name: 'X', email: `x-${randomUUID().slice(0, 6)}@greekos.test`, consent: true } });
    expect(r.status()).toBe(403);
  } finally {
    await db.from('platform_settings').update({ registration_mode: before.registration_mode }).eq('id', true);
  }
});
