import { describe, expect, it } from 'vitest';
import { applyCourseRules, courseRuleFindings } from '@/lib/speaking/grammar-rules';
import { unknownGreekWords } from '@/lib/qa/run';

/**
 * Course grammar rules on learner phrases. Every correct phrase below must stay untouched (precision
 * first); the dictionary-backed rules need hunspell el_GR (skipped on a machine without it).
 * The same rules run over the whole vetted corpus in scripts/rules-on-corpus.ts (0 hits in 6 623 sentences).
 */
const dict = (await unknownGreekWords(new Set(['και']))).unknown !== null;

const first = async (t: string) => (await courseRuleFindings(t))[0] ?? null;

describe('course grammar rules', () => {
  it('rules that need no dictionary: σε + article, numerals, a coffee vs a café', async () => {
    expect(await first('Πάω σε το σπίτι μου.')).toMatchObject({ rule: 'se_article', quote: 'σε το', better_el: 'στο' });
    expect(await first('Θα πάμε σε την παραλία.')).toMatchObject({ better_el: 'στην' });
    expect(await first('Θέλω ένα καφέ και ένα νερό, παρακαλώ.')).toMatchObject({ rule: 'numeral', quote: 'ένα καφέ', better_el: 'έναν καφέ' });
    expect(await first('Είναι τρεις ευρώ.')).toMatchObject({ better_el: 'τρία ευρώ' });
    for (const ok of ['Δουλεύω σε ένα καφέ.', 'Υπάρχει ένα καφέ δίπλα στο μάθημα.', 'Στις τέσσερις παρά τέταρτο.', 'Θέλω έναν μικρό καφέ.', 'Θέλω καφέ και νερό.']) expect(await first(ok)).toBeNull();
  }, 60_000);

  it.skipIf(!dict)('dictionary-backed rules: να after a modal, person, plural after a number, masculine accusative', async () => {
    expect(await first('Πρέπει φτάνω πριν τις τρεις.')).toMatchObject({ rule: 'modal_na', better_el: 'Πρέπει να φτάνω' });
    expect(await first('Θέλω πάω στο κέντρο.')).toMatchObject({ better_el: 'Θέλω να πάω' });
    expect(await first('Εγώ θέλει να ρωτήσω.')).toMatchObject({ rule: 'pronoun_verb', better_el: 'Εγώ θέλω' });
    expect(await first('Εσύ θέλω ένα τσάι;')).toMatchObject({ better_el: 'Εσύ θέλεις' });
    expect(await first('Θέλω δύο κιλό πορτοκάλι.')).toMatchObject({ rule: 'number_plural', better_el: 'δύο κιλά πορτοκάλια' });
    expect(await first('Χτες πήγα στο Λευκό Πύργο.')).toMatchObject({ rule: 'masc_article', better_el: 'στον Λευκό Πύργο' });
    expect(await first('Περιμένω στο σταθμό.')).toMatchObject({ better_el: 'στον σταθμό' });
    for (const ok of ['Θέλω δύο κιλά πορτοκάλια.', 'Πήγα στο κέντρο.', 'Είναι στο λευκό σπίτι.', 'Αύριο στις επτά στο πάρκο.', 'Πόσο κάνουν όλα μαζί;', 'Μπορείτε να μου πείτε;', 'Πρέπει να φύγω.', 'Θέλω ένα κιλό μήλα.', 'Μπορεί αύριο.']) expect(await first(ok)).toBeNull();
  }, 60_000);

  it('the persona\'s reply is corrected before it is voiced', async () => {
    expect((await applyCourseRules('Εντάξει. Ένα καφέ και ένα νερό. Πάμε σε το τραπέζι;')).text).toBe('Εντάξει. Έναν καφέ και ένα νερό. Πάμε στο τραπέζι;');
  });
});
