/**
 * Applies the digital-QA engineering fixes (src/lib/qa/engineering-fixes.ts) as new revisions with the
 * system actor `digital-qa-engineering`. Idempotent; part of scripts/setup-local.sh.
 *   npx tsx --conditions=react-server scripts/qa-engineering-fixes.ts
 */
import { applyEngineeringFixes } from '../src/lib/qa/engineering-fixes.ts';

applyEngineeringFixes().then((r) => { console.log(JSON.stringify({ command: 'qa-engineering-fixes', results: r }, null, 2)); process.exit(0); }, (e) => { console.error(e); process.exit(1); });
