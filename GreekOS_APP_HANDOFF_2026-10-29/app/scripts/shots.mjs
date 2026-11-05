// Screenshot helper for design review: node scripts/shots.mjs <email> <password> <outDir> <width> <route...>
import { chromium } from 'playwright';
const [email, password, out, width, ...routes] = process.argv.slice(2);
const base = process.env.APP_URL ?? 'http://127.0.0.1:3210';
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const w = Number(width || 1440);
const ctx = await browser.newContext({ viewport: { width: w, height: w <= 430 ? 860 : 900 }, deviceScaleFactor: w <= 430 ? 2 : 1, reducedMotion: process.env.REDUCED ? 'reduce' : 'no-preference' });
const page = await ctx.newPage();
await page.goto(`${base}/login`);
await page.fill('input[type=email]', email);
await page.fill('input[type=password]', password);
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 }), page.click('button[type=submit]')]);
for (const r of routes) {
  await page.goto(`${base}${r}`, { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForTimeout(900);
  const name = `${w}_${r.replace(/[^a-z0-9]+/gi, '_') || 'home'}.png`;
  await page.screenshot({ path: `${out}/${name}`, fullPage: !!process.env.FULL });
  console.log(name);
}
await browser.close();
