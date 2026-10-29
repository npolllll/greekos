import { test, expect } from '@playwright/test';
import { readState, makeUser, admin, type E2EUser } from './fixtures';
import { login } from './helpers';

/**
 * Learner journey on synthetic released fixtures: from-zero learner → home shows the next lesson
 * → answers (correct / wrong) → contextual "Почему так?" → a second tab receives the confirmed
 * server event through Realtime without a manual reload.
 */
async function fresh<T>(role: 'learner' | 'owner_admin', enrolled: boolean, fn: (u: E2EUser) => Promise<T>) {
  const u = await makeUser(role, enrolled);
  try { return await fn(u); } finally { await admin().auth.admin.deleteUser(u.id); }
}

test('from-zero learner: lesson, feedback, context card and realtime sync', async ({ browser }) => fresh('learner', true, async (learner) => {
  const s = { learner };
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  await login(a, s.learner);
  await login(b, s.learner);

  await expect(a.getByRole('heading', { level: 1 })).toContainText('Добро пожаловать');
  await expect(a.getByText('Синтетический тестовый урок (e2e)').first()).toBeVisible();
  await expect(b.getByText('Пока нет событий')).toBeVisible();

  await a.getByRole('link', { name: /Продолжить урок/ }).click();
  await a.waitForURL(/\/lesson\/SYN-UNIT-A1/);
  await a.getByRole('tab', { name: /Контролируемая практика/ }).click();

  // Correct short answer with case/space normalisation (accents preserved).
  const first = a.locator('.player').filter({ hasText: 'Η Ρόζα' });
  await first.getByLabel('Ваш ответ').fill('  ΕΊΝΑΙ ');
  await first.getByRole('button', { name: 'Проверить' }).click();
  await expect(first.locator('.verdict')).toContainText('Верно');

  // Realtime: the second tab updates from the server event, no reload.
  await expect(b.getByText('Ответ сохранён').first()).toBeVisible({ timeout: 20_000 });

  // Wrong choice → confirmed error → contextual explanation from the released unit.
  const second = a.locator('.player').filter({ hasText: 'Εγώ ___' });
  await second.getByRole('radio', { name: 'είναι' }).click();
  await second.getByRole('button', { name: 'Проверить' }).click();
  await expect(second.locator('.verdict')).toContainText('Есть ошибка');
  await second.getByRole('button', { name: 'Почему так?' }).click();
  await expect(second.locator('.context-coach')).toContainText('Синтетический тестовый урок');
  await second.getByRole('tab', { name: 'Новое задание' }).click();
  await expect(second.locator('.context-coach')).toContainText('Новое самостоятельное задание');

  // Error Notebook shows evidence only for the confirmed error.
  await a.goto('/errors');
  await expect(a.getByText(/Неверный выбор/).first()).toBeVisible();

  // Progress never shows a B2 percentage.
  await a.goto('/progress');
  await expect(a.getByText(/Процент B2 не показывается/)).toBeVisible();
  await ctxA.close();
  await ctxB.close();
}));

test('learner cannot open the owner admin panel', async ({ page }) => {
  const s = readState();
  await login(page, s.learner);
  await page.goto('/admin');
  await expect(page).not.toHaveURL(/\/admin/);
});

test('new learner without enrollment is sent to onboarding, chooses "from zero"', async ({ page }) => fresh('learner', false, async (learner2) => {
  await login(page, learner2);
  await page.waitForURL(/\/welcome/);
  await page.getByRole('radio', { name: /С полного нуля/ }).click();
  await page.getByRole('button', { name: 'Начать' }).click();
  await page.waitForURL((u) => u.pathname === '/');
  await page.goto('/course');
  // Foundations first: the alphabet unit (U-A1-007) heads the route, regardless of its ID order.
  await expect(page.locator('.unit-row').first()).toContainText('Алфавит');
  await expect(page.getByText('Старт с нуля: алфавит и звуки')).toBeAttached();
}));

test('owner sees gated corpus honestly and can open the admin panel', async ({ page }) => {
  const s = readState();
  await login(page, s.owner);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin/);
  await page.goto('/exams');
  await expect(page.getByText('KEG-B2-F02').or(page.getByText('F02')).first()).toBeVisible();
});
