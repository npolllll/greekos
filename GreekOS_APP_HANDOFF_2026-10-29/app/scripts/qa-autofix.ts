/**
 * Applies deterministic digital-QA corrections (mixed alphabets) as new revisions, recorded with the
 * system actor `digital-qa-autofix`. Idempotent: only open issues are touched.
 *   npx tsx scripts/qa-autofix.ts
 */
import { autofixMixedScript } from '../src/lib/qa/autofix.ts';

autofixMixedScript().then((r) => { console.log(JSON.stringify({ command: 'qa-autofix', results: r }, null, 2)); process.exit(0); }, (e) => { console.error(e); process.exit(1); });
