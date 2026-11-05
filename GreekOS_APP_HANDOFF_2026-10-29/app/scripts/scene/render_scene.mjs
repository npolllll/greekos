// Rasterise the original GreekOS scene SVG with Chromium, then encode WebP variants with ffmpeg.
// Usage: node scripts/scene/render_scene.mjs   (requires playwright + ffmpeg with libwebp)
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../public/scene');
const svg = readFileSync(join(root, 'thessaloniki.svg'), 'utf8');
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 2400, height: 1500 }, deviceScaleFactor: 1 });
await page.setContent(`<html><body style="margin:0">${svg}</body></html>`);
await page.screenshot({ path: join(root, 'thessaloniki.png'), clip: { x: 0, y: 0, width: 2400, height: 1500 } });
await browser.close();
const ff = (args) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...args]);
// Sharp hero (used inside cards) and a pre-blurred backdrop (no runtime blur cost behind glass panels).
ff(['-i', join(root, 'thessaloniki.png'), '-vf', 'scale=1920:-1', '-c:v', 'libwebp', '-quality', '84', join(root, 'thessaloniki-hero.webp')]);
ff(['-i', join(root, 'thessaloniki.png'), '-vf', 'scale=1600:-1,gblur=sigma=11,eq=saturation=1.12:contrast=1.03', '-c:v', 'libwebp', '-quality', '80', join(root, 'thessaloniki-backdrop.webp')]);
ff(['-i', join(root, 'thessaloniki.png'), '-vf', 'crop=1300:1500:1100:0,scale=780:-1,gblur=sigma=8,eq=saturation=1.1', '-c:v', 'libwebp', '-quality', '78', join(root, 'thessaloniki-backdrop-portrait.webp')]);
console.log('scene rendered');
