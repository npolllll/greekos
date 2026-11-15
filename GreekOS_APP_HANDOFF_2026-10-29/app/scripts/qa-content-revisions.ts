/**
 * Applies the recorded methodological content revisions (src/lib/qa/content-revisions.ts) as new
 * revisions with history; idempotent. Run after the corpus import and digital QA:
 *   npx tsx --conditions=react-server scripts/qa-content-revisions.ts
 */
import { existsSync, readFileSync } from 'node:fs';
import { applyExplanationRevisions, ENGLISH_ONLY_REASON, type ExplanationRevision, applyUnitOrderRevisions, applyReadingItems, applyPromptRevisions, applyExamPairRevisions, applySpacingRevisions, applyAiReviewRevisions, applyAiTextRevisions, applyAudioFlagRevisions, applyPegpCompletion, type ReviewFix, type TextFix } from '../src/lib/qa/content-revisions.ts';

const explanations = await applyExplanationRevisions();
// 103 ΚΕΓ / ΠΕΓΠ tasks whose author's note was English only (never shown): Russian explanations by the AI editor.
const englishOnly = JSON.parse(readFileSync(new URL('../src/lib/qa/data/explanations-en-2026-11-15.json', import.meta.url), 'utf8')) as { revisions: ExplanationRevision[] };
const explanationsEn = await applyExplanationRevisions(englishOnly.revisions, ENGLISH_ONLY_REASON);
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
// The reviewers read texts with the number spacing already restored: on a fresh install the spacing pass runs
// before their fixes too, so one run converges (otherwise U-A2-015-I19 applied only on the next deploy).
const spacingBefore = await applySpacingRevisions();
const finalItems = await applyAiReviewRevisions(final.item_fixes, FINAL_LABEL);
const finalTexts = await applyAiTextRevisions(final.text_fixes, FINAL_LABEL);
// Criteria still run together after the 15.11 review (47 strings in 32 tasks): words separated, meaning unchanged.
const criteriaSpacing = JSON.parse(readFileSync(new URL('../src/lib/qa/data/criteria-spacing-2026-11-15.json', import.meta.url), 'utf8')) as { text_fixes: TextFix[] };
const criteriaTexts = await applyAiTextRevisions(criteriaSpacing.text_fixes, 'AI-редактор 15.11.2026 (не преподаватель)');
// Real Greek review tasks referred to a «text of the day» that does not exist (12 tasks): self-contained prompt.
const rgRetention = JSON.parse(readFileSync(new URL('../src/lib/qa/data/rg-retention-2026-11-15.json', import.meta.url), 'utf8')) as { item_fixes: ReviewFix[]; text_fixes: TextFix[] };
const rgPrompts = await applyAiReviewRevisions(rgRetention.item_fixes, 'AI-редактор 15.11.2026 (не преподаватель)');
const rgCriteria = await applyAiTextRevisions(rgRetention.text_fixes, 'AI-редактор 15.11.2026 (не преподаватель)');
const audioFlags = await applyAudioFlagRevisions();
// Last: the spacing pass runs over the texts the earlier revisions produced.
const spacing = await applySpacingRevisions();
const count = (s: string) => explanations.filter((x) => x.status === s).length;
const tally = (xs: Array<{ status: string }>) => Object.fromEntries(['applied', 'already', 'changed_since', 'missing'].map((k) => [k, xs.filter((x) => x.status === k).length]));
console.log(JSON.stringify({ final_review: { items: tally(finalItems), items_not_applied: finalItems.filter((x) => x.status === 'changed_since' || x.status === 'missing').map((x) => x.item_id), texts: tally(finalTexts), texts_not_applied: finalTexts.filter((x) => x.status === 'changed_since' || x.status === 'missing').map((x) => ({ id: x.id, failed: x.failed })), audio_flags: audioFlags.applied.length }, pegp, ai_review: { total: review.length, applied: review.filter((x) => x.status === 'applied').length, already: review.filter((x) => x.status === 'already').length, changed_since: review.filter((x) => x.status === 'changed_since').map((x) => x.item_id), missing: review.filter((x) => x.status === 'missing').map((x) => x.item_id) }, spacing: { applied: spacingBefore.applied + spacing.applied }, exam_pairs: { total: examPairs.length, applied: examPairs.filter((x) => x.status === 'applied').length, already: examPairs.filter((x) => x.status === 'already').length, changed_since: examPairs.filter((x) => x.status === 'changed_since').map((x) => x.item_id) }, wording: { total: wording.length, applied: wording.filter((x) => x.status === 'applied').length, already: wording.filter((x) => x.status === 'already').length, changed_since: wording.filter((x) => x.status === 'changed_since').map((x) => x.item_id), missing: wording.filter((x) => x.status === 'missing').map((x) => x.item_id) }, unit_order: order, reading_items: { total: reading.length, applied: reading.filter((x) => x.status === 'applied').length, already: reading.filter((x) => x.status === 'already').length, changed_since: reading.filter((x) => x.status === 'changed_since').map((x) => x.item_id) }, explanations: { total: explanations.length, applied: count('applied'), already: count('already'), changed_since: count('changed_since'), missing: count('missing') }, explanations_en: tally(explanationsEn), criteria_spacing: tally(criteriaTexts), rg_retention: { prompts: tally(rgPrompts), criteria: tally(rgCriteria) }, changed_since: explanations.filter((x) => x.status === 'changed_since').map((x) => x.item_id) }, null, 1));
process.exit(0);
