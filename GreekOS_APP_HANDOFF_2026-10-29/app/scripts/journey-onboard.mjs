// Local acceptance helper: log in and complete onboarding ("from zero") for a learner account.
// node scripts/journey-onboard.mjs <email> <password> <outDir>
import { chromium } from 'playwright';
const [email, password, out] = process.argv.slice(2);
const base = process.env.APP_URL ?? 'http://127.0.0.1:3210';
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto(`${base}/login`);
await page.fill('input[type=email]', email);
await page.fill('input[type=password]', password);
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 }), page.click('button[type=submit]')]);
await page.waitForLoadState('networkidle');
console.log('after login:', page.url());
if (page.url().includes('/welcome')) {
  await page.screenshot({ path: `${out}/1440_welcome.png` });
  await page.getByRole('radio', { name: /С полного нуля/ }).click();
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/welcome'), { timeout: 60000 }), page.getByRole('button', { name: 'Начать' }).click()]);
  await page.waitForLoadState('networkidle');
  console.log('after onboarding:', page.url());
}
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/1440_learner_home.png` });
await browser.close();
