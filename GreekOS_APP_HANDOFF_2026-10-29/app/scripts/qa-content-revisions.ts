/**
 * Applies the recorded methodological content revisions (src/lib/qa/content-revisions.ts) as new
 * revisions with history; idempotent. Run after the corpus import and digital QA:
 *   npx tsx --conditions=react-server scripts/qa-content-revisions.ts
 */
import { applyExplanationRevisions, applyUnitOrderRevisions, applyReadingItems } from '../src/lib/qa/content-revisions.ts';

const explanations = await applyExplanationRevisions();
const order = await applyUnitOrderRevisions();
const reading = await applyReadingItems();
const count = (s: string) => explanations.filter((x) => x.status === s).length;
console.log(JSON.stringify({ unit_order: order, reading_items: { total: reading.length, applied: reading.filter((x) => x.status === 'applied').length, already: reading.filter((x) => x.status === 'already').length, changed_since: reading.filter((x) => x.status === 'changed_since').map((x) => x.item_id) }, explanations: { total: explanations.length, applied: count('applied'), already: count('already'), changed_since: count('changed_since'), missing: count('missing') }, changed_since: explanations.filter((x) => x.status === 'changed_since').map((x) => x.item_id) }, null, 1));
process.exit(0);
