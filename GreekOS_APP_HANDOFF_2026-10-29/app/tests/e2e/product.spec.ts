import { test, expect, type Page } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { readState, makeUser, admin } from './fixtures';
import { login } from './helpers';

/**
 * End-to-end over the real corpus (not synthetic fixtures), as the owner in preview (writes no
 * mastery): every item type opens in its player and returns a verdict; a lesson of every level of the
 * route A0 → B2 opens with its stages; an exam component runs in practice mode and is submitted;
 * the owner's admin screens for learners, QA, release, audio, voices and policy open with data.
 */
const ITEMS = new URL('../../.corpus-snapshot/HANDOFF_IMPORT/items.json', import.meta.url);

interface Item { item_id: string; type: string; requires_audio: boolean; options: unknown; scoring: { strategy: string } }

/** One item per type, preferring ones without audio (owner preview of unreleased audio is separate). */
function onePerType(): Item[] {
  const items: Item[] = JSON.parse(readFileSync(ITEMS, 'utf8'));
  const by = new Map<string, Item>();
  for (const it of items) {
    const cur = by.get(it.type);
    if (!cur || (cur.requires_audio && !it.requires_audio)) by.set(it.type, it);
  }
  return [...by.values()].sort((a, b) => a.type.localeCompare(b.type));
}

async function answer(page: Page) {
  const radios = page.locator('[role="radiogroup"] [role="radio"]');
  if (await radios.count()) { await radios.first().click(); return 'choice'; }
  const field = page.locator('textarea.greek-input, input.greek-input').first();
  if (await field.count()) { await field.fill('Δεν ξέρω ακόμα.'); return 'text'; }
  return 'none';
}

test.describe('product on the real corpus (owner preview)', () => {
  test.skip(!existsSync(ITEMS), 'нет снимка корпуса');

  test('every item type opens in its player and returns a verdict', async ({ page }) => {
    test.setTimeout(15 * 60_000);
    const { owner } = readState();
    await login(page, owner);
    const problems: string[] = [];
    for (const it of onePerType()) {
      await page.goto(`/practice/${encodeURIComponent(it.item_id)}?preview=1`);
      await expect(page.getByText('Предпросмотр владельца').first()).toBeVisible({ timeout: 30_000 });
      const how = await answer(page);
      // A listening item without released audio says so instead of offering answers (by design).
      if (how === 'none' && it.requires_audio && await page.getByText(/аудио/i).first().isVisible()) continue;
      if (how === 'none') { problems.push(`${it.type} ${it.item_id}: нет поля ответа`); continue; }
      await page.getByRole('button', { name: 'Проверить' }).click();
      const verdict = page.locator('.verdict').first();
      try {
        await expect(verdict).toBeVisible({ timeout: 120_000 });
      } catch {
        problems.push(`${it.type} ${it.item_id}: нет вердикта`);
      }
    }
    expect(problems).toEqual([]);
  });

  test('route A0 → B2: a lesson of every level opens with its stages', async ({ page }) => {
    test.setTimeout(5 * 60_000);
    const { owner } = readState();
    await login(page, owner);
    for (const level of ['A0', 'A1', 'A2', 'B1', 'B2']) {
      await page.goto(`/course?level=${level}`);
      const first = page.locator('.unit-list .unit-row').first();
      await expect(first).toBeVisible({ timeout: 30_000 });
      await first.click();
      await page.waitForURL(/\/lesson\//);
      await expect(page.getByRole('tab', { name: /Теория/ })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole('tab', { name: /Практика/ })).toBeVisible();
    }
  });

  test('exam: a reading component in practice mode is answered and submitted (DEV-PREVIEW tester)', async ({ page }) => {
    test.setTimeout(5 * 60_000);
    // The owner only previews exams (no attempts); a local test account with DEV-PREVIEW takes one.
    const { owner } = readState();
    const tester = await makeUser('learner', true);
    const db = admin();
    await db.from('profiles').update({ account_kind: 'dev_preview_tester' }).eq('user_id', tester.id);
    const now = Date.now();
    const g = await db.from('dev_preview_access').upsert({ user_id: tester.id, granted_by: owner.id, granted_at: new Date(now).toISOString(), expires_at: new Date(now + 86_400_000).toISOString(), scope: 'all_gated_content' });
    expect(g.error).toBeNull();
    try {
    await login(page, tester);
    await page.goto('/exams/KEG-B2-R03');
    await page.getByRole('radio', { name: /Практика без таймера/ }).click();
    await page.getByRole('button', { name: 'Начать' }).click();
    await expect(page.getByRole('button', { name: /^Сдать/ }).first()).toBeVisible({ timeout: 30_000 });
    const q = page.locator('[role="radiogroup"] [role="radio"]').first();
    if (await q.count()) await q.click();
    await page.getByRole('button', { name: /^Сдать/ }).first().click();
    await page.getByRole('button', { name: 'Сдать', exact: true }).last().click();
    await expect(page.getByText(/Попытка сдана|Идёт подсчёт/).first()).toBeVisible({ timeout: 60_000 });
    } finally {
      await db.auth.admin.deleteUser(tester.id);
    }
  });

  test('owner admin screens open with real data', async ({ page }) => {
    test.setTimeout(5 * 60_000);
    const { owner } = readState();
    await login(page, owner);
    const screens: Array<[string, RegExp]> = [
      ['/admin', /Ученики и прогресс/], ['/admin/learners', /Ученик/], ['/admin/qa', /Цифровой QA|пакет/i], ['/admin/qa/release', /Что выпускаем/],
      ['/admin/content', /Задания по модулям/], ['/admin/audio', /Очередь аудио/], ['/admin/voices', /Роли кастинга/], ['/admin/policy', /политик/i],
      ['/admin/exams', /КЕГ|Экзамен/i], ['/admin/preview', /DEV-PREVIEW/],
    ];
    for (const [path, text] of screens) {
      await page.goto(path);
      await expect(page.getByText(text).first()).toBeVisible({ timeout: 30_000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    }
  });

  test('an unknown address shows the GreekOS page, not the framework 404', async ({ page }) => {
    await login(page, readState().owner);
    await page.goto('/такой-страницы-нет');
    await expect(page.getByRole('heading', { name: 'Страница не найдена' })).toBeVisible();
  });
});
