import { describe, expect, it } from 'vitest';
import { READING_ITEMS } from '@/lib/qa/data/reading-items';
import { EXPLANATION_REVISIONS, UNIT_ORDER_REVISIONS, readingEnvelope } from '@/lib/qa/content-revisions';
import { scoreDeterministic } from '@/lib/scoring/score';
import { buildItemDTO, assertNoLeak } from '@/lib/content/dto';
import { choiceOptions } from '@/lib/content/types';
import { explanationsFor } from '@/lib/learning/attempts';

/**
 * Methodological revisions of 05.11.2026: Russian explanations, lesson order, reading tasks.
 * The texts are AI-assisted and not a teacher's review; these tests check that they work as tasks.
 */
const unitFor = (unit_id: string) => ({ unit_id, level: unit_id.split('-')[1], primary_competencies: ['X-01'], prerequisites: [] as string[] });
const GREEK_WORD = /[Ͱ-Ͽἀ-῿]+/gu;
const MIN_WORDS: Record<string, number> = { A2: 30, B1: 40, B2: 60 };

describe('reading tasks added to lessons without connected input', () => {
  it('cover 13 distinct lessons, each with a connected text of its level', () => {
    expect(new Set(READING_ITEMS.map((r) => r.unit_id)).size).toBe(13);
    for (const r of READING_ITEMS) {
      const level = r.unit_id.split('-')[1];
      expect(r.item_id.startsWith(`${r.unit_id}-I`)).toBe(true);
      expect((r.text.match(GREEK_WORD) ?? []).length, r.item_id).toBeGreaterThanOrEqual(MIN_WORDS[level]);
      // Greek words never mix in Latin/Cyrillic look-alikes; final sigma only at word end.
      expect(r.text.match(/[Ͱ-Ͽ]+[A-Za-zА-Яа-я]|[A-Za-zА-Яа-я][Ͱ-Ͽ]+/u), r.item_id).toBeNull();
      expect(r.text.match(/ς[Ͱ-Ͽ]/u), r.item_id).toBeNull();
    }
  });

  it('the key is right and every other option is wrong', () => {
    for (const r of READING_ITEMS) {
      const env = readingEnvelope(r, unitFor(r.unit_id));
      if (r.type === 'mcq') {
        const opts = choiceOptions(env.options);
        expect(opts.length).toBeGreaterThanOrEqual(3);
        for (const o of opts) {
          const v = scoreDeterministic(env, { choice: o.key }).verdict;
          expect(v, `${r.item_id} «${o.label}»`).toBe(r.answer.includes(o.label) ? 'CORRECT' : 'INCORRECT_CONFIRMED');
        }
      } else {
        for (const a of [...r.answer, ...(r.alternatives ?? [])]) expect(['CORRECT', 'ACCEPTABLE_VARIANT']).toContain(scoreDeterministic(env, { text: a }).verdict);
        expect(scoreDeterministic(env, { text: 'ανακύκλωσης' }).verdict).not.toBe('CORRECT');
      }
    }
  });

  it('the learner DTO carries neither the key nor the explanation', () => {
    for (const r of READING_ITEMS) {
      const env = readingEnvelope(r, unitFor(r.unit_id));
      const dto = buildItemDTO({ item: env, contentHash: 'x'.repeat(64) });
      expect(() => assertNoLeak(dto)).not.toThrow();
      expect(JSON.stringify(dto)).not.toContain(r.explanation_ru.slice(0, 40));
      expect(() => assertNoLeak({ ...dto, answer_explanation_ru: 'x' })).toThrow(/leak/);
    }
  });
});

describe('Russian explanations', () => {
  it('59 explanations, written in Russian, quoting Greek', () => {
    expect(EXPLANATION_REVISIONS).toHaveLength(59);
    for (const r of EXPLANATION_REVISIONS) {
      const letters = r.explanation_ru.match(/\p{L}/gu)?.length ?? 1;
      expect((r.explanation_ru.match(/[А-Яа-яЁё]/g)?.length ?? 0) / letters, r.item_id).toBeGreaterThan(0.45);
      expect(r.explanation_ru, r.item_id).toMatch(/«[^»]*[Ͱ-Ͽἀ-῿][^»]*»/u);
    }
  });

  it('are shown first; the Greek author note follows only at B1–B2; diagnostics show neither', () => {
    const base = { answer_explanation_ru: 'Объяснение по-русски', original_payload: { rationale: 'Η εξήγηση στα ελληνικά.' } };
    expect(explanationsFor({ ...base, level: 'B2' }, false)).toEqual({ explanation_ru: 'Объяснение по-русски', explanation_el: 'Η εξήγηση στα ελληνικά.' });
    expect(explanationsFor({ ...base, level: 'A2' }, false)).toEqual({ explanation_ru: 'Объяснение по-русски', explanation_el: null });
    expect(explanationsFor({ ...base, level: 'B2' }, true)).toEqual({ explanation_ru: null, explanation_el: null });
    expect(explanationsFor({ level: 'A1', original_payload: { rationale: 'Пояснение автора.' } }, false)).toEqual({ explanation_ru: 'Пояснение автора.', explanation_el: null });
  });
});

describe('lesson order', () => {
  it('B1-G10 (cause, purpose, result) is taught before the lesson that requires it', () => {
    const at = Object.fromEntries(UNIT_ORDER_REVISIONS.map((r) => [r.unit_id, r.after]));
    expect(at['U-B1-008']).toBeLessThan(at['U-B1-007']);
  });
});
