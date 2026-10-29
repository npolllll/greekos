import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readState } from './fixtures';
import { login, noHorizontalScroll } from './helpers';

const LEARNER_PAGES = ['/', '/course', '/lesson/SYN-UNIT-A1', '/practice', '/speaking', '/listening', '/writing', '/errors', '/progress', '/exams', '/pegp', '/real-greek', '/diagnostic', '/settings'];

test('learner screens: no horizontal scroll and no serious axe violations', async ({ page }, info) => {
  const s = readState();
  await login(page, s.learner);
  for (const path of LEARNER_PAGES) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await noHorizontalScroll(page);
    if (info.project.name === 'desktop-1440' || path === '/') {
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).disableRules(['color-contrast']).analyze();
      const serious = r.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
      expect(serious.map((v) => `${path}: ${v.id} — ${v.nodes.length}`)).toEqual([]);
    }
    await page.screenshot({ path: `test-results/screens/${info.project.name}${path.replace(/\//g, '_') || '_home'}.png`, fullPage: false });
  }
});

test('owner admin screens: no horizontal scroll', async ({ page }, info) => {
  const s = readState();
  await login(page, s.owner);
  for (const path of ['/admin', '/admin/learners', '/admin/content', '/admin/audio', '/admin/voices', '/admin/policy', '/admin/reviews', '/admin/providers']) {
    const res = await page.goto(path);
    if (res && res.status() === 404) continue;
    await page.waitForLoadState('networkidle');
    await noHorizontalScroll(page);
    await page.screenshot({ path: `test-results/screens/${info.project.name}${path.replace(/\//g, '_')}.png` });
  }
});

test('speaking screens (live voice UI v5.4): no horizontal scroll, accessible controls', async ({ page }, info) => {
  const s = readState();
  await login(page, s.owner);
  await page.goto('/speaking');
  await page.waitForLoadState('networkidle');
  await noHorizontalScroll(page);
  const r = await page.request.post('/api/speaking', { data: { action: 'start', scenario_id: 'SC01', mode: 'roleplay', input_mode: 'voice', idempotency_key: `resp-${info.project.name}-${Date.now()}`, voice_persona: 'TUTOR_F', transport: 'stream_local_gateway' } });
  test.skip(!r.ok(), 'голосовой режим не настроен в этой среде');
  const { session_id } = await r.json();
  await page.goto(`/speaking/${session_id}`);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('.voice-stage .status-live')).toBeVisible();
  await noHorizontalScroll(page);
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).disableRules(['color-contrast']).analyze();
  expect(axe.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious').map((v) => `${v.id} — ${v.nodes.length}`)).toEqual([]);
  await page.screenshot({ path: `test-results/screens/${info.project.name}_speaking_live.png` });
});

test('keyboard: skip link and visible focus', async ({ page }) => {
  const s = readState();
  await login(page, s.learner);
  await page.goto('/progress');
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo(0, 0); });
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Перейти к содержанию' });
  await expect(skip).toBeFocused();
  // Focus ring is visible (outline from the design system).
  const outline = await skip.evaluate((el) => getComputedStyle(el).outlineStyle + ' ' + getComputedStyle(el).top);
  expect(outline).not.toMatch(/^none/);
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
});

test('reduced motion preference disables animations', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const s = readState();
  await login(page, s.learner);
  const dur = await page.evaluate(() => getComputedStyle(document.querySelector('.screen.active')!).animationDuration);
  expect(['0.00001s', '1e-05s', '0s']).toContain(dur);
  await ctx.close();
});
