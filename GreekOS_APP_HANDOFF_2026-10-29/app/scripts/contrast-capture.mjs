// Pixel-based WCAG contrast capture (S9): node scripts/contrast-capture.mjs <creds.txt> <outDir> <paths...>; then python3 scripts/contrast_eval.py <outDir>.
// Text colour (computed) vs the real rendered background (screenshot with all text made transparent).
import { chromium } from 'playwright';
import fs from 'node:fs';
const [credFile, outDir, ...paths] = process.argv.slice(2);
const [email, password] = fs.readFileSync(credFile, 'utf8').trim().split(/\s+/);
const base = 'http://127.0.0.1:3210';
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}) });
const ctx = await browser.newContext({ viewport: { width: Number(process.env.W ?? 1440), height: 900 }, reducedMotion: 'reduce' });
const page = await ctx.newPage();
await page.goto(`${base}/login`); await page.fill('input[type=email]', email); await page.fill('input[type=password]', password);
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 90000 }), page.click('button[type=submit]')]);
let k = 0;
for (const p of paths) {
  await page.goto(`${base}${p}`, { waitUntil: 'networkidle', timeout: 180000 });
  await page.waitForTimeout(1200);
  for (const y of [0, 800]) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(500);
    const els = await page.evaluate(() => {
      const out = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const seen = new Set();
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.textContent.trim()) continue;
        const el = n.parentElement;
        if (!el || seen.has(el)) continue;
        seen.add(el);
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
        const range = document.createRange(); range.selectNodeContents(n);
        const r = range.getBoundingClientRect();
        if (r.width < 4 || r.height < 6 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
        // Covered text (under a fixed bar or a dev overlay) is not shown: the topmost element at its centre must be it.
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (top && top !== el && !el.contains(top) && !top.contains(el)) continue;
        // Text scrolled under the sticky frosted top bar is covered, not shown: skip it.
        if (scrollY > 0 && r.top < 125 && !el.closest('.topbar, header, [role=banner], aside, nav')) continue;
        let op = 1; for (let e = el; e; e = e.parentElement) op *= Number(getComputedStyle(e).opacity);
        if (op < 0.2) continue;
        out.push({ text: n.textContent.trim().slice(0, 40), color: cs.color, size: parseFloat(cs.fontSize), weight: Number(cs.fontWeight) || 400, opacity: op, box: [r.left, r.top, r.width, r.height], disabled: !!el.closest('[disabled],[aria-disabled=true]') });
      }
      return out;
    });
    const shot = `${outDir}/bg_${k}.png`;
    await page.addStyleTag({ content: '*{color:transparent !important;text-shadow:none !important;caret-color:transparent !important} svg{visibility:hidden !important}', }).then((h) => h.evaluate((s) => { s.id = '__hide'; }));
    await page.waitForTimeout(250);
    await page.screenshot({ path: shot });
    await page.evaluate(() => document.getElementById('__hide')?.remove());
    fs.writeFileSync(`${outDir}/els_${k}.json`, JSON.stringify({ page: p, y, els }));
    k++;
  }
}
await browser.close();
console.log('captured', k);
