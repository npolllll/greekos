// Records real browser captures of the running app (S9): short videos + screenshots of key flows.
//   PW_CHROMIUM_PATH=/opt/pw-browsers/chromium node scripts/capture-v6.mjs <learner.txt> <owner.txt> [outDir]
// Credential files hold "email password". Nothing here is a mock-up: every frame is the live app.
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const [learnerFile, ownerFile, outArg] = process.argv.slice(2);
const out = outArg ?? 'reports/v6/captures';
const base = process.env.APP_URL ?? 'http://127.0.0.1:3210';
const creds = (f) => readFileSync(f, 'utf8').trim().split(/\s+/);
mkdirSync(join(out, 'screens'), { recursive: true });
mkdirSync(join(out, 'videos'), { recursive: true });
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const pause = (p, ms = 900) => p.waitForTimeout(ms);

// Video: frames from the DevTools screencast (what the page really painted), encoded to VP8/WebM at a
// constant 25 fps by ffmpeg (FFMPEG_PATH, or Playwright's bundled build). Without ffmpeg: screenshots only.
const FFMPEG = process.env.FFMPEG_PATH ?? ['/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux', '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'].find((p) => existsSync(p));

async function startRecording(ctx, page, viewport) {
  const cdp = await ctx.newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    frames.push({ buf: Buffer.from(data, 'base64'), t: metadata.timestamp });
    await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 82, maxWidth: viewport.width * (viewport.width <= 430 ? 2 : 1), maxHeight: viewport.height * (viewport.width <= 430 ? 2 : 1) });
  return async (file) => {
    await cdp.send('Page.stopScreencast').catch(() => {});
    if (!FFMPEG || frames.length < 2) return false;
    const ff = spawn(FFMPEG, ['-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', '25', '-i', 'pipe:0', '-y', '-an', '-c:v', 'vp8', '-b:v', '2M', '-deadline', 'good', '-pix_fmt', 'yuv420p', file]);
    const done = new Promise((res) => ff.on('close', (code) => res(code === 0)));
    const t0 = frames[0].t;
    let emitted = 0;
    for (let i = 0; i < frames.length; i++) {
      const until = i + 1 < frames.length ? frames[i + 1].t - t0 : frames[i].t - t0 + 1;
      while (emitted / 25 < until) { if (!ff.stdin.write(frames[i].buf)) await new Promise((r) => ff.stdin.once('drain', r)); emitted++; }
    }
    ff.stdin.end();
    return done;
  };
}

const ONLY = process.env.FLOWS ? process.env.FLOWS.split(',') : null;
async function flow(name, [email, password], viewport, run) {
  if (ONLY && !ONLY.includes(name)) return;
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: viewport.width <= 430 ? 2 : 1 });
  const page = await ctx.newPage();
  const stop = await startRecording(ctx, page, viewport);
  const shot = async (n) => { await pause(page, 600); await page.screenshot({ path: join(out, 'screens', `${name}_${n}.png`) }); };
  await page.goto(`${base}/login`);
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', password);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 90000 }), page.click('button[type=submit]')]);
  await page.waitForLoadState('networkidle');
  try { await run(page, shot); } catch (e) { console.error(`${name}: ${e.message.split('\n')[0]}`); await shot('error'); }
  const ok = await stop(join(out, 'videos', `${name}.webm`));
  await ctx.close();
  console.log('captured', name, ok ? '(video)' : '(screenshots only)');
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
  // the transfer task inside the context card has its own «Проверить»: take the main one (first in the player)
  await player.getByRole('button', { name: 'Проверить' }).first().click();
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
