/**
 * Applies the recorded methodological content revisions (src/lib/qa/content-revisions.ts) as new
 * revisions with history; idempotent. Run after the corpus import and digital QA:
 *   npx tsx --conditions=react-server scripts/qa-content-revisions.ts
 */
import { existsSync, readFileSync } from 'node:fs';
import { applyExplanationRevisions, applyUnitOrderRevisions, applyReadingItems, applyPromptRevisions, applyExamPairRevisions, applySpacingRevisions, applyAiReviewRevisions, applyAiTextRevisions, applyAudioFlagRevisions, applyPegpCompletion, type ReviewFix, type TextFix } from '../src/lib/qa/content-revisions.ts';

const explanations = await applyExplanationRevisions();
const order = await applyUnitOrderRevisions();
const reading = await applyReadingItems();
const wording = await applyPromptRevisions();
const examPairs = await applyExamPairRevisions();
const reviewFile = new URL('../src/lib/qa/data/ai-review-2026-11-13.json', import.meta.url);
const review = existsSync(reviewFile) ? await applyAiReviewRevisions(JSON.parse(readFileSync(reviewFile, 'utf8')) as ReviewFix[]) : [];
const pegp = await applyPegpCompletion();
// Final AI review of 15.11.2026: 11 independent AI reviewers by corpus slice, every fix re-checked by the AI
// editor against the production text (not a teacher's review). Tasks, then lessons/scenarios/texts.
const final = JSON.parse(readFileSync(new URL('../src/lib/qa/data/ai-review-2026-11-15.json', import.meta.url), 'utf8')) as { item_fixes: ReviewFix[]; text_fixes: TextFix[] };
const FINAL_LABEL = 'AI-рецензия 15.11.2026 (независимые AI-рецензенты + вторая AI-проверка, не преподаватель)';
const finalItems = await applyAiReviewRevisions(final.item_fixes, FINAL_LABEL);
const finalTexts = await applyAiTextRevisions(final.text_fixes, FINAL_LABEL);
const audioFlags = await applyAudioFlagRevisions();
// Last: the spacing pass runs over the texts the earlier revisions produced.
const spacing = await applySpacingRevisions();
const count = (s: string) => explanations.filter((x) => x.status === s).length;
const tally = (xs: Array<{ status: string }>) => Object.fromEntries(['applied', 'already', 'changed_since', 'missing'].map((k) => [k, xs.filter((x) => x.status === k).length]));
console.log(JSON.stringify({ final_review: { items: tally(finalItems), items_not_applied: finalItems.filter((x) => x.status === 'changed_since' || x.status === 'missing').map((x) => x.item_id), texts: tally(finalTexts), texts_not_applied: finalTexts.filter((x) => x.status === 'changed_since' || x.status === 'missing').map((x) => ({ id: x.id, failed: x.failed })), audio_flags: audioFlags.applied.length }, pegp, ai_review: { total: review.length, applied: review.filter((x) => x.status === 'applied').length, already: review.filter((x) => x.status === 'already').length, changed_since: review.filter((x) => x.status === 'changed_since').map((x) => x.item_id), missing: review.filter((x) => x.status === 'missing').map((x) => x.item_id) }, spacing: { applied: spacing.applied }, exam_pairs: { total: examPairs.length, applied: examPairs.filter((x) => x.status === 'applied').length, already: examPairs.filter((x) => x.status === 'already').length, changed_since: examPairs.filter((x) => x.status === 'changed_since').map((x) => x.item_id) }, wording: { total: wording.length, applied: wording.filter((x) => x.status === 'applied').length, already: wording.filter((x) => x.status === 'already').length, changed_since: wording.filter((x) => x.status === 'changed_since').map((x) => x.item_id), missing: wording.filter((x) => x.status === 'missing').map((x) => x.item_id) }, unit_order: order, reading_items: { total: reading.length, applied: reading.filter((x) => x.status === 'applied').length, already: reading.filter((x) => x.status === 'already').length, changed_since: reading.filter((x) => x.status === 'changed_since').map((x) => x.item_id) }, explanations: { total: explanations.length, applied: count('applied'), already: count('already'), changed_since: count('changed_since'), missing: count('missing') }, changed_since: explanations.filter((x) => x.status === 'changed_since').map((x) => x.item_id) }, null, 1));
process.exit(0);
