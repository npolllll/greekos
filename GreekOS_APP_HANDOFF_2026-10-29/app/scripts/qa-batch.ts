/**
 * Run one digital QA batch over the corpus (same code as Админ → Цифровой QA → «Запустить проверку»).
 *   npx tsx scripts/qa-batch.ts [--label "..."] [--unit U-A1-007]
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
if (existsSync(resolve('.env.local'))) {
  for (const line of readFileSync(resolve('.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
const { runQaBatch } = await import('../src/lib/qa/run.ts');
const args = process.argv.slice(2);
const arg = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const unit = arg('--unit');
const t0 = Date.now();
const r = await runQaBatch({ actorId: null, label: arg('--label') ?? `CLI ${new Date().toISOString()}`, scope: unit ? { kind: 'unit', ids: [unit] } : { kind: 'all' }, reportDir: arg('--out') });
console.log(JSON.stringify({ ...r, ms: Date.now() - t0 }, null, 2));
