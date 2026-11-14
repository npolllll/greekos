/**
 * Applies the recorded methodological content revisions (src/lib/qa/content-revisions.ts) as new
 * revisions with history; idempotent. Run after the corpus import and digital QA:
 *   npx tsx --conditions=react-server scripts/qa-content-revisions.ts
 */
import { existsSync, readFileSync } from 'node:fs';
import { applyExplanationRevisions, applyUnitOrderRevisions, applyReadingItems, applyPromptRevisions, applyExamPairRevisions, applySpacingRevisions, applyAiReviewRevisions, applyPegpCompletion, type ReviewFix } from '../src/lib/qa/content-revisions.ts';

const explanations = await applyExplanationRevisions();
const order = await applyUnitOrderRevisions();
const reading = await applyReadingItems();
const wording = await applyPromptRevisions();
const examPairs = await applyExamPairRevisions();
const reviewFile = new URL('../src/lib/qa/data/ai-review-2026-11-13.json', import.meta.url);
const review = existsSync(reviewFile) ? await applyAiReviewRevisions(JSON.parse(readFileSync(reviewFile, 'utf8')) as ReviewFix[]) : [];
const pegp = await applyPegpCompletion();
// Last: the spacing pass runs over the texts the earlier revisions produced.
const spacing = await applySpacingRevisions();
const count = (s: string) => explanations.filter((x) => x.status === s).length;
console.log(JSON.stringify({ pegp, ai_review: { total: review.length, applied: review.filter((x) => x.status === 'applied').length, already: review.filter((x) => x.status === 'already').length, changed_since: review.filter((x) => x.status === 'changed_since').map((x) => x.item_id), missing: review.filter((x) => x.status === 'missing').map((x) => x.item_id) }, spacing: { applied: spacing.applied }, exam_pairs: { total: examPairs.length, applied: examPairs.filter((x) => x.status === 'applied').length, already: examPairs.filter((x) => x.status === 'already').length, changed_since: examPairs.filter((x) => x.status === 'changed_since').map((x) => x.item_id) }, wording: { total: wording.length, applied: wording.filter((x) => x.status === 'applied').length, already: wording.filter((x) => x.status === 'already').length, changed_since: wording.filter((x) => x.status === 'changed_since').map((x) => x.item_id), missing: wording.filter((x) => x.status === 'missing').map((x) => x.item_id) }, unit_order: order, reading_items: { total: reading.length, applied: reading.filter((x) => x.status === 'applied').length, already: reading.filter((x) => x.status === 'already').length, changed_since: reading.filter((x) => x.status === 'changed_since').map((x) => x.item_id) }, explanations: { total: explanations.length, applied: count('applied'), already: count('already'), changed_since: count('changed_since'), missing: count('missing') }, changed_since: explanations.filter((x) => x.status === 'changed_since').map((x) => x.item_id) }, null, 1));
process.exit(0);
