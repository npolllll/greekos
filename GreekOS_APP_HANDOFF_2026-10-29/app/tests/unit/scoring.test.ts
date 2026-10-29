import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { scoreDeterministic, scoreJointVector, UnsupportedContentError, InvalidResponseError, parsePairs } from '@/lib/scoring/score';
import { normalizeByPolicy } from '@/lib/scoring/normalize';
import { adapterFor, type ItemEnvelope } from '@/lib/content/types';

const corpus = resolve(process.env.CORPUS_ROOT ?? '../spec/GreekOS_CLAUDE_UPLOAD_READY');
const items: ItemEnvelope[] = JSON.parse(readFileSync(resolve(corpus, 'HANDOFF_IMPORT/items.json'), 'utf8'));
const byId = new Map(items.map((i) => [i.item_id, i]));
const item = (id: string) => byId.get(id)!;

describe('every imported item type has an explicit adapter', () => {
  it('no item falls through to an implicit renderer', () => {
    const unsupported = items.filter((i) => !adapterFor(i.type, i.options));
    expect(unsupported.map((i) => i.item_id)).toEqual([]);
  });
  it('unknown types fail closed with UNSUPPORTED_CONTENT_TYPE', () => {
    const fake = { ...item('D-A1-GRAMMAR-01'), type: 'hologram' } as ItemEnvelope;
    expect(() => scoreDeterministic(fake, { text: 'x' })).toThrow(UnsupportedContentError);
  });
});

describe('short answers keep Greek accents and item normalisation', () => {
  const it1 = item('D-A1-GRAMMAR-01'); // key: είναι
  it('exact key with case/space normalisation is correct', () => {
    expect(scoreDeterministic(it1, { text: '  ΕΊΝΑΙ ' }).verdict).toBe('CORRECT');
  });
  it('accent-only difference is a non-meaning orthography error, not "correct"', () => {
    const r = scoreDeterministic(it1, { text: 'ειναι' });
    expect(r.verdict).toBe('INCORRECT_CONFIRMED');
    expect(r.errorKind).toBe('accent_orthography');
    expect(r.meaningChanging).toBe(false);
  });
  it('unlisted plausible answer goes to review without penalty', () => {
    const r = scoreDeterministic(it1, { text: 'ήταν' });
    expect(r.verdict).toBe('PENDING_REVIEW');
    expect(r.reliable).toBe(false);
    expect(r.needsReview).toBe(true);
  });
  it('final sigma and NFC are normalised', () => {
    expect(normalizeByPolicy('ΚΑΦΕΣ')).toBe(normalizeByPolicy('καφεσ'));
    expect(normalizeByPolicy('έ'.normalize('NFD'))).toBe('έ');
  });
  it('empty answers are rejected rather than scored', () => {
    expect(() => scoreDeterministic(it1, { text: '   ' })).toThrow(InvalidResponseError);
  });
});

describe('choice items score only the approved key with stable option keys', () => {
  const mcq = item('D-A1-VOCABULARY-01'); // φούρνος at index 0
  it('correct key', () => expect(scoreDeterministic(mcq, { choice: '0' }).verdict).toBe('CORRECT'));
  it('wrong option is reliable incorrect', () => {
    const r = scoreDeterministic(mcq, { choice: '2' });
    expect(r.verdict).toBe('INCORRECT_CONFIRMED');
    expect(r.reliable).toBe(true);
  });
  it('forged option key is invalid', () => expect(() => scoreDeterministic(mcq, { choice: '99' })).toThrow(InvalidResponseError));
});

describe('structured items validate the full submitted vector', () => {
  it('matching accepts any separator formatting', () => {
    const m = item('PEGP-P04-GEO-002'); // 1-Β, 2-Α
    expect(scoreDeterministic(m, { text: '2-α, 1-β' }).verdict).toBe('CORRECT');
    expect(scoreDeterministic(m, { text: '1 Β; 2 Α' }).verdict).toBe('CORRECT');
    expect(scoreDeterministic(m, { text: '1-Α, 2-Β' }).verdict).toBe('INCORRECT_CONFIRMED');
    expect(parsePairs('1Β, 2Α', ['NFC', 'trim', 'casefold'])).toEqual(['1:β', '2:α']);
  });
  it('ordering accepts documented alternatives', () => {
    const o = item('PEGP-P03-HIS-003'); // Β, Α
    expect(scoreDeterministic(o, { text: 'Β → Α' }).verdict).toBe('CORRECT');
    expect(scoreDeterministic(o, { text: 'Α, Β' }).verdict).toBe('INCORRECT_CONFIRMED');
  });
});

describe('open responses are never compared to one model answer', () => {
  it('writing goes to rubric review', () => {
    const w = item('KEG-B2-P01-W01');
    const r = scoreDeterministic(w, { text: String(w.model_response) });
    expect(r.verdict).toBe('PENDING_REVIEW');
    expect(r.needsReview).toBe(true);
  });
  it('REVIEW_REQUIRED keyed answers are provisional (unreliable)', () => {
    const p = item('PEGP-LANG-P04-01');
    const r = scoreDeterministic(p, { text: 'Θράκη' });
    expect(r.verdict).toBe('CORRECT');
    expect(r.reliable).toBe(false);
  });
});

describe('U01 joint adjudication', () => {
  const adj = JSON.parse(readFileSync(resolve(corpus, 'GreekOS_B2_Exam_Bank/U01_JOINT_ADJUDICATION.json'), 'utf8'));
  it('canonical and documented alternative are provisional candidates, others held', () => {
    expect(scoreJointVector(adj, adj.canonical_solution).verdict).toBe('CORRECT');
    expect(scoreJointVector(adj, adj.defensible_complete_alternative).verdict).toBe('ACCEPTABLE_VARIANT');
    expect(scoreJointVector(adj, adj.additional_candidate_solutions[0].answers).verdict).toBe('PENDING_REVIEW');
    expect(scoreJointVector(adj, adj.canonical_solution).reliable).toBe(false);
  });
});
