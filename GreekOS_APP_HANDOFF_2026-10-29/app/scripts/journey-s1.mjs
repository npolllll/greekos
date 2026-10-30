// Local acceptance S1 (real canonical lesson U-A1-007): wrong answer → "Почему так?" → retry.
// node scripts/journey-s1.mjs <email> <password> <outDir> [videoDir]
import { chromium } from 'playwright';
const [email, password, out, videoDir] = process.argv.slice(2);
const base = process.env.APP_URL ?? 'http://127.0.0.1:3210';
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...(videoDir ? { recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } } } : {}) });
const page = await ctx.newPage();
const shot = async (n) => { await page.waitForTimeout(700); await page.screenshot({ path: `${out}/s1_${n}.png` }); console.log('shot', n); };
await page.goto(`${base}/login`);
await page.fill('input[type=email]', email);
await page.fill('input[type=password]', password);
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 }), page.click('button[type=submit]')]);
await page.waitForLoadState('networkidle');
await shot('01_home');
await page.getByRole('link', { name: /Продолжить урок/ }).first().click();
await page.waitForURL(/\/lesson\//, { timeout: 60000 });
await page.waitForLoadState('networkidle');
await shot('02_lesson_theory');
await page.getByRole('tab', { name: /Фразы и слова/ }).click();
await shot('03_phrases');
const say = page.getByRole('button', { name: /^Послушать:/ }).first();
if (await say.count()) {
  await say.click();
  await page.waitForTimeout(9000);
  await shot('04_phrase_playing');
}
await page.getByRole('tab', { name: /Практика/ }).click();
await page.waitForTimeout(600);
const player = page.locator('.player').first();
await player.getByRole('radio', { name: 'σ', exact: true }).click();
await player.getByRole('button', { name: 'Проверить' }).click();
await player.locator('.verdict').waitFor({ timeout: 30000 });
await shot('05_wrong_verdict');
const why = player.getByRole('button', { name: 'Почему так?' });
if (await why.count()) {
  await why.click();
  await player.locator('.context-coach').waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  await player.locator('.context-coach').scrollIntoViewIfNeeded();
  await shot('06_why_context');
  await player.getByRole('tab', { name: 'Новое задание' }).click();
  await shot('07_transfer_task');
}
await player.getByRole('button', { name: 'Ещё раз' }).click();
await player.getByRole('radio', { name: 'ς', exact: true }).click();
await player.getByRole('button', { name: 'Проверить' }).click();
await player.locator('.verdict').waitFor({ timeout: 30000 });
await player.scrollIntoViewIfNeeded();
await shot('08_retry_correct');
await ctx.close();
await browser.close();
