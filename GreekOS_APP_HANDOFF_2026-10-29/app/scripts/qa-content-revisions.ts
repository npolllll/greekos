/**
 * Applies the recorded methodological content revisions (src/lib/qa/content-revisions.ts) as new
 * revisions with history; idempotent. Run after the corpus import and digital QA:
 *   npx tsx --conditions=react-server scripts/qa-content-revisions.ts
 */
import { applyExplanationRevisions, applyUnitOrderRevisions, applyReadingItems, applyPromptRevisions, applyExamPairRevisions } from '../src/lib/qa/content-revisions.ts';

const explanations = await applyExplanationRevisions();
const order = await applyUnitOrderRevisions();
const reading = await applyReadingItems();
const wording = await applyPromptRevisions();
const examPairs = await applyExamPairRevisions();
const count = (s: string) => explanations.filter((x) => x.status === s).length;
console.log(JSON.stringify({ exam_pairs: { total: examPairs.length, applied: examPairs.filter((x) => x.status === 'applied').length, already: examPairs.filter((x) => x.status === 'already').length, changed_since: examPairs.filter((x) => x.status === 'changed_since').map((x) => x.item_id) }, wording: { total: wording.length, applied: wording.filter((x) => x.status === 'applied').length, already: wording.filter((x) => x.status === 'already').length, changed_since: wording.filter((x) => x.status === 'changed_since').map((x) => x.item_id), missing: wording.filter((x) => x.status === 'missing').map((x) => x.item_id) }, unit_order: order, reading_items: { total: reading.length, applied: reading.filter((x) => x.status === 'applied').length, already: reading.filter((x) => x.status === 'already').length, changed_since: reading.filter((x) => x.status === 'changed_since').map((x) => x.item_id) }, explanations: { total: explanations.length, applied: count('applied'), already: count('already'), changed_since: count('changed_since'), missing: count('missing') }, changed_since: explanations.filter((x) => x.status === 'changed_since').map((x) => x.item_id) }, null, 1));
process.exit(0);
