import { describe, expect, it } from 'vitest';
import { JsonFieldStream, SentenceCutter } from '@/lib/speaking/stream-json';
import { fixNumeralAgreement, greekWords } from '@/lib/speaking/greek-guard';
import { ruleFeedback } from '@/lib/speaking/conversation';

describe('streaming JSON field reader', () => {
  it('decodes the reply field across arbitrary chunk boundaries, including escapes', () => {
    const js = new JsonFieldStream('reply_el');
    const raw = '{"stage":"TWIST","reply_el":"Ναι. Ένα \\"φρέσκο\\" κιλό\\nκαι \\u03b1υτό.","intent":"on_task"}';
    let got = '';
    for (let i = 0; i < raw.length; i += 3) got += js.push(raw.slice(i, i + 3));
    expect(got).toBe('Ναι. Ένα "φρέσκο" κιλό\nκαι αυτό.');
    expect(js.complete).toBe(true);
  });

  it('emits nothing until the field starts', () => {
    const js = new JsonFieldStream('reply_el');
    expect(js.push('{"stage":"OPEN",')).toBe('');
    expect(js.complete).toBe(false);
  });
});

describe('sentence cutter', () => {
  it('voices a short opening reaction at once, keeps later short fragments with the next, flushes the tail', () => {
    const c = new SentenceCutter();
    const out = [...c.push('Ναι. Βεβαίως, ένα κιλό μήλα. Ωραία. Θέλετε '), ...c.push('κάτι άλλο; Τέλος')];
    expect(out).toEqual(['Ναι.', 'Βεβαίως, ένα κιλό μήλα.', 'Ωραία. Θέλετε κάτι άλλο;']);
    expect(c.flush()).toEqual(['Τέλος']);
  });
});

describe('Greek guard helpers', () => {
  it('repairs numeral gender agreement, both directions', () => {
    expect(fixNumeralAgreement('Είναι τρεις ευρώ, τέσσερις κιλά και τρία ώρες. Μία ευρώ.').text).toBe('Είναι τρία ευρώ, τέσσερα κιλά και τρεις ώρες. Ένα ευρώ.');
    expect(fixNumeralAgreement('Τρεις φίλοι και τέσσερα παιδιά.').fixes).toEqual([]);
    // «ένα» + a frequent masculine accusative noun (the learner error a small model tends to echo).
    expect(fixNumeralAgreement('Εντάξει. Ένα καφέ και ένα νερό.').text).toBe('Εντάξει. Έναν καφέ και ένα νερό.');
  });

  it('turns a numeral-agreement error of the learner into a rule-labelled correction', async () => {
    expect(await ruleFeedback('Θέλω ένα καφέ και ένα νερό, παρακαλώ.')).toMatchObject({ quote: 'ένα καφέ', better_el: 'έναν καφέ', kind: 'error', source: 'rule:numeral' });
    expect(await ruleFeedback('Είναι τρεις ευρώ;')).toMatchObject({ quote: 'τρεις ευρώ', better_el: 'τρία ευρώ' });
    expect(await ruleFeedback('Θέλω ένα χυμό και έναν καφέ.')).toBeNull();
  });

  it('lists Greek word forms only', () => {
    expect(greekWords('Ναι, OK — 3 κιλά «μήλα»!')).toEqual(['ναι', 'κιλά', 'μήλα']);
  });
});

describe('mixed-alphabet autofix', async () => {
  const { fixMixedWord, fixMixedText } = await import('@/lib/qa/autofix');
  it('rewrites a word in its majority alphabet when every foreign letter has a look-alike', () => {
    expect(fixMixedWord('Κороткое')).toBe('Короткое');
    expect(fixMixedWord('кλεισμένες')).toBe('κλεισμένες');
    expect(fixMixedWord('Короткое')).toBeNull();
    expect(fixMixedWord('Βж')).toBeNull(); // ж has no Greek look-alike → a person decides
    expect(fixMixedText('Κороткое объяснение: кλεισμένες πόρτες.').fixes).toHaveLength(2);
  });
});

describe('Russian plural forms', async () => {
  const { countRu, singularVerbRu } = await import('@/lib/plural-ru');
  it('picks the form by the last digits', () => {
    expect([1, 2, 5, 11, 12, 21, 22, 44, 111, 0].map((n) => countRu(n, 'сценарий', 'сценария', 'сценариев'))).toEqual(['1 сценарий', '2 сценария', '5 сценариев', '11 сценариев', '12 сценариев', '21 сценарий', '22 сценария', '44 сценария', '111 сценариев', '0 сценариев']);
    expect([1, 11, 21].map(singularVerbRu)).toEqual([true, false, true]);
  });
});
