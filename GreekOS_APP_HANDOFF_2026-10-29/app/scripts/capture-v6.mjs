// Records real browser captures of the running app (S9): short videos + screenshots of key flows.
//   PW_CHROMIUM_PATH=/opt/pw-browsers/chromium node scripts/capture-v6.mjs <learner.txt> <owner.txt> [outDir]
// Credential files hold "email password". Nothing here is a mock-up: every frame is the live app.
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const [learnerFile, ownerFile, outArg] = process.argv.slice(2);
const out = outArg ?? 'reports/v6/captures';
const base = process.env.APP_URL ?? 'http://127.0.0.1:3210';
const creds = (f) => readFileSync(f, 'utf8').trim().split(/\s+/);
mkdirSync(join(out, 'screens'), { recursive: true });
mkdirSync(join(out, 'videos'), { recursive: true });
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const pause = (p, ms = 900) => p.waitForTimeout(ms);

async function flow(name, [email, password], viewport, run) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: viewport.width <= 430 ? 2 : 1, recordVideo: { dir: join(out, 'videos'), size: viewport } });
  const page = await ctx.newPage();
  const shot = async (n) => { await pause(page, 600); await page.screenshot({ path: join(out, 'screens', `${name}_${n}.png`) }); };
  await page.goto(`${base}/login`);
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', password);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 90000 }), page.click('button[type=submit]')]);
  await page.waitForLoadState('networkidle');
  try { await run(page, shot); } catch (e) { console.error(`${name}: ${e.message.split('\n')[0]}`); await shot('error'); }
  const video = page.video();
  await ctx.close();
  if (video) renameSync(await video.path(), join(out, 'videos', `${name}.webm`));
  console.log('captured', name);
}

// 1. Learner from zero: home → alphabet → canonical lesson (DEV-PREVIEW) → error → «Почему так?» → transfer → retry.
await flow('s1_learner_journey', creds(learnerFile), { width: 1440, height: 900 }, async (page, shot) => {
  await shot('01_home');
  await page.getByRole('link', { name: /Алфавит и звуки/ }).first().click();
  await page.waitForURL(/\/alphabet/);
  await page.waitForLoadState('networkidle');
  await shot('02_alphabet');
  await page.getByRole('option', { name: /Β β/ }).click();
  await pause(page, 700);
  await page.locator('.alpha-detail').getByRole('button', { name: /^Послушать:/ }).first().click();
  await pause(page, 6000);
  await shot('03_alphabet_letter');
  await page.getByRole('button', { name: 'Найди строчную' }).click();
  await page.locator('.drill-opt').first().click();
  await shot('04_alphabet_drill');
  await page.getByRole('link', { name: /Главная/ }).first().click();
  await page.waitForURL((u) => u.pathname === '/');
  await page.getByRole('link', { name: /Продолжить урок/ }).first().click();
  await page.waitForURL(/\/lesson\//, { timeout: 60000 });
  await page.waitForLoadState('networkidle');
  await shot('05_lesson_theory');
  await page.getByRole('tab', { name: /Фразы и слова/ }).click();
  await shot('06_lesson_phrases');
  await page.getByRole('tab', { name: /Практика/ }).click();
  const player = page.locator('.player').first();
  await player.getByRole('radio', { name: 'σ', exact: true }).click();
  await player.getByRole('button', { name: 'Проверить' }).click();
  await player.locator('.verdict').waitFor({ timeout: 30000 });
  await shot('07_wrong_answer');
  await player.getByRole('button', { name: 'Почему так?' }).click();
  await player.locator('.context-coach').waitFor({ timeout: 30000 });
  await player.locator('.context-coach').scrollIntoViewIfNeeded();
  await shot('08_why');
  await player.getByRole('tab', { name: 'Новое задание' }).click();
  await shot('09_transfer');
  await player.getByRole('button', { name: 'Ещё раз' }).click();
  await player.getByRole('radio', { name: 'ς', exact: true }).click();
  await player.getByRole('button', { name: 'Проверить' }).click();
  await player.locator('.verdict').waitFor({ timeout: 30000 });
  await shot('10_retry_correct');
  await page.goto(`${base}/progress`, { waitUntil: 'networkidle' });
  await shot('11_progress');
});

// 2. AI Speaking: scenario cards → session (text mode) → a turn through the dialogue engine.
await flow('s4_speaking', creds(learnerFile), { width: 1440, height: 900 }, async (page, shot) => {
  await page.goto(`${base}/speaking`, { waitUntil: 'networkidle' });
  await shot('01_picker');
  await page.locator('.sc-grid').scrollIntoViewIfNeeded();
  await shot('02_cards');
  await page.locator('.sc-card', { hasText: 'SC05' }).first().getByRole('button', { name: 'Текстом' }).click();
  await page.waitForURL(/\/speaking\/[0-9a-f-]{36}/, { timeout: 60000 });
  await page.waitForSelector('#typed', { timeout: 60000 });
  await shot('03_session');
  await page.fill('#typed', 'Έναν καφέ, μικρό, παρακαλώ.');
  await page.getByRole('button', { name: 'Отправить', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.msg:not(.mine)').length >= 2, null, { timeout: 120000 });
  await shot('04_reply');
});

// 3. Owner: overview → digital QA → audio queue with listening → learner card.
await flow('s7_owner', creds(ownerFile), { width: 1440, height: 900 }, async (page, shot) => {
  await page.goto(`${base}/admin`, { waitUntil: 'networkidle' });
  await shot('01_overview');
  await page.goto(`${base}/admin/qa`, { waitUntil: 'networkidle' });
  await shot('02_qa');
  await page.goto(`${base}/admin/audio?f=verified`, { waitUntil: 'networkidle' });
  await shot('03_audio');
  await page.getByRole('button', { name: /Прослушать/ }).first().click();
  await page.locator('audio').first().waitFor({ timeout: 30000 });
  await page.locator('audio').first().evaluate((a) => a.play().catch(() => {}));
  await pause(page, 4000);
  await shot('04_audio_playing');
  await page.goto(`${base}/admin/learners`, { waitUntil: 'networkidle' });
  await page.locator('table a, .data-table a').first().click();
  await page.waitForLoadState('networkidle');
  await shot('05_learner_card');
});

// 4. Mobile 390: home → bottom navigation → route → alphabet.
await flow('s9_mobile', creds(learnerFile), { width: 390, height: 844 }, async (page, shot) => {
  await shot('01_home');
  await page.getByRole('link', { name: 'Курс' }).click();
  await page.waitForURL(/\/course/);
  await page.waitForLoadState('networkidle');
  await shot('02_course');
  await page.goto(`${base}/alphabet`, { waitUntil: 'networkidle' });
  await shot('03_alphabet');
  await page.getByRole('option', { name: /Λ λ/ }).click();
  await pause(page, 1200);
  await shot('04_alphabet_detail');
});

await browser.close();
