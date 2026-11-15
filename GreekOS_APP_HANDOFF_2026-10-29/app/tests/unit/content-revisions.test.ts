import { describe, expect, it } from 'vitest';
import { READING_ITEMS } from '@/lib/qa/data/reading-items';
import { EXPLANATION_REVISIONS, UNIT_ORDER_REVISIONS, readingEnvelope, applyTextPatches } from '@/lib/qa/content-revisions';
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
    // ΠΕΓΠ / Real Greek keep the author's Russian note in rationale_ru: it is the explanation shown.
    expect(explanationsFor({ level: 'B1', answer_explanation_ru: undefined, original_payload: { rationale_ru: 'Возничий — в музее Дельф.' } } as never, false)).toEqual({ explanation_ru: 'Возничий — в музее Дельф.', explanation_el: null });
    // An English-only note is still not shown; a revision wins over the author's note.
    expect(explanationsFor({ level: 'B2', answer_explanation_ru: undefined, original_payload: { rationale: 'Danae no preference; Sofia remote.' } } as never, false).explanation_ru).toBeNull();
    expect(explanationsFor({ level: 'B1', answer_explanation_ru: 'Правка', original_payload: { rationale_ru: 'Автор' } } as never, false).explanation_ru).toBe('Правка');
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

describe('AI review text fixes in lessons, scenarios and cards', () => {
  it('applies an addition that keeps the original sentence once, and collapses copies left by repeated runs', () => {
    const cur = 'Отличайте событие от состояния.';
    const tail = ' Простое «закрыто» — κλειστός.';
    const patch = [{ op: 'replace_text' as const, field: 'theory_ru', current: cur, new: cur + tail }];
    const first = applyTextPatches({ theory_ru: `Начало. ${cur} Конец.` }, patch);
    expect(first.applied).toBe(1);
    const second = applyTextPatches(first.next, patch);
    expect(second.applied).toBe(0);
    expect(second.already).toBe(1);
    // Before 15.11 every deploy appended the addition again (six copies on production).
    const repeated = { theory_ru: `Начало. ${cur}${tail.repeat(6)} Конец.` };
    const fixed = applyTextPatches(repeated, patch);
    expect(fixed.applied).toBe(1);
    expect(fixed.repaired).toBe(1);
    expect((fixed.next as { theory_ru: string }).theory_ru).toBe(`Начало. ${cur}${tail} Конец.`);
    expect(applyTextPatches(fixed.next, patch).applied).toBe(0);
  });
  const scenario = { nodes: [{ node_id: 'OPEN', assistant_el: 'Καλημέρα! Τι θέλεις;', acceptable_examples_el: ['Θέλω ένα καφέ.'] }, { node_id: 'B1', assistant_el: 'Τι θέλεις;' }] };
  it('replaces a snippet that occurs exactly once and leaves the original untouched', () => {
    const r = applyTextPatches(scenario, [{ op: 'replace_text', field: 'nodes[0].acceptable_examples_el', current: 'ένα καφέ', new: 'έναν καφέ' }]);
    expect(r.applied).toBe(1);
    expect((r.next as typeof scenario).nodes[0].acceptable_examples_el![0]).toBe('Θέλω έναν καφέ.');
    expect(scenario.nodes[0].acceptable_examples_el![0]).toBe('Θέλω ένα καφέ.');
    expect(r.changed[0].path).toBe('nodes[0].acceptable_examples_el[0]');
  });
  it('refuses an ambiguous snippet and an absent one; reports an already applied fix', () => {
    const amb = applyTextPatches(scenario, [{ op: 'replace_text', current: 'Τι θέλεις;', new: 'Τι θέλετε;' }]);
    expect(amb.applied).toBe(0);
    expect(amb.failed[0].reason).toContain('2');
    const narrowed = applyTextPatches(scenario, [{ op: 'replace_text', field: 'nodes[1]', current: 'Τι θέλεις;', new: 'Τι θέλετε;' }]);
    expect(narrowed.applied).toBe(1);
    const again = applyTextPatches(narrowed.next, [{ op: 'replace_text', field: 'nodes[1]', current: 'Τι θέλεις;', new: 'Τι θέλετε;' }]);
    expect(again.applied).toBe(0);
    expect(again.already).toBe(1);
    expect(applyTextPatches(scenario, [{ op: 'replace_text', current: 'Γεια', new: 'Γεια σου' }]).failed[0].reason).toBe('фрагмент не найден');
    // A prefix is a whole path segment: «nodes[1]» does not reach «nodes[10]», «criteria» not «original_payload.criteria».
    const env = { criteria: ['комната2'], original_payload: { criteria: ['комната2'] } };
    const c = applyTextPatches(env, [{ op: 'replace_text', field: 'criteria', current: 'комната2', new: 'комната 2' }]);
    expect(c.applied).toBe(1);
    expect((c.next as typeof env).original_payload.criteria[0]).toBe('комната2');
  });
});

describe('a listening task whose recording does not exist yet', () => {
  const base = { item_id: 'X', module: 'core', unit_id: 'U', item_type: 'short_answer', level: 'A1', pool: null, scoring_strategy: 'EXACT_WITH_REVIEW_FALLBACK', competency_ids: [], prerequisite_ids: [], error_tags: [], envelope: {} as never, current_hash: 'h' };
  const released = new Map([['X', { content_hash: 'h', decision: 'APPROVED', revoked_at: null, expires_at: null } as never]]);
  it('waits for audio instead of becoming a speaking task', async () => {
    const { itemAccess, awaitsRecording } = await import('@/lib/content/repo');
    const listening = { ...base, section: 'listening', requires_audio: true, audio_job_ids: [] };
    expect(awaitsRecording(listening)).toBe(true);
    expect(itemAccess(listening, released, new Map()).learnerUsable).toBe(false);
    expect(itemAccess({ ...listening, requires_audio: false }, released, new Map()).reason).toBe('AUDIO_PENDING');
    // A speaking task (the learner's own speech) stays usable without stimulus audio.
    expect(itemAccess({ ...listening, section: 'speaking' }, released, new Map()).learnerUsable).toBe(true);
  });
});

describe('a text written into the task is shown', () => {
  it('shows { text }, { text, origin } and { text_el }, but never a transcript reserved for after the attempt', async () => {
    const { buildItemDTO } = await import('@/lib/content/dto');
    const env = (stimulus: unknown) => ({ item_id: 'X', type: 'short_answer', module: 'core', level: 'A1', prompt: 'Π;', options: [], stimulus, requires_audio: false, criteria: [] }) as never;
    expect(buildItemDTO({ item: env({ text: 'Με λένε Σοφία.' }), contentHash: 'h' }).stimulus).toEqual({ kind: 'inline', text: 'Με λένε Σοφία.' });
    expect(buildItemDTO({ item: env({ text: 'Κείμενο.', origin: 'ORIGINAL_GREEKOS_TEXT' }), contentHash: 'h' }).stimulus?.text).toBe('Κείμενο.');
    expect(buildItemDTO({ item: env({ text_el: 'Συμμετοχή δωρεάν.' }), contentHash: 'h' }).stimulus?.text).toBe('Συμμετοχή δωρεάν.');
    expect(buildItemDTO({ item: env({ text_el: 'Απομαγνητοφώνηση.', display_policy: 'AFTER_ATTEMPT_ONLY' }), contentHash: 'h' }).stimulus).toBeNull();
  });
  it('a «fill the summary» task shows the gapped summary with its source text', async () => {
    const { buildItemDTO } = await import('@/lib/content/dto');
    const item = { item_id: 'KEG-B2-R03-S01', type: 'short_answer', module: 'keg_b2', level: 'B2', prompt: 'Συμπληρώστε το κενό (1) της περίληψης.', options: [], stimulus: { gap: 1, text_id: 'T2', summary_id: 'SUM' }, requires_audio: false, criteria: [] } as never;
    const dto = buildItemDTO({ item, contentHash: 'h', textObject: { text: 'Η ιστορία.' }, summaryObject: { text: 'Μια οικογένεια είχε ζητήσει δωμάτιο στο (1) ___.' } });
    expect(dto.stimulus?.text).toBe('Η ιστορία.');
    expect(dto.stimulus?.summary?.text).toContain('(1) ___');
    expect(buildItemDTO({ item, contentHash: 'h', textObject: { text: 'Η ιστορία.' } }).stimulus?.summary).toBeUndefined();
  });
});

describe('spacing restored for display', () => {
  it('adds the space lost after punctuation in Russian text, never in Greek or in decimals', async () => {
    const { restorePunctuationSpacing, displaySpacing } = await import('@/lib/content/spacing');
    expect(restorePunctuationSpacing('сообщите другу,что вчера оставили у него книгу,и спросите,можно ли')).toBe('сообщите другу, что вчера оставили у него книгу, и спросите, можно ли');
    expect(restorePunctuationSpacing('Ела дома.Не в парке')).toBe('Ела дома. Не в парке');
    expect(displaySpacing('дома,30 минут,читали')).toBe('дома, 30 минут, читали');
    expect(restorePunctuationSpacing('κράτησα ό,τι μου είχε φανεί χρήσιμο')).toBe('κράτησα ό,τι μου είχε φανεί χρήσιμο');
    expect(restorePunctuationSpacing('1,5 часа; т.е. так')).toBe('1,5 часа; т.е. так');
  });
});
