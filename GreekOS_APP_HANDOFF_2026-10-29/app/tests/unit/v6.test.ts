import { describe, expect, it } from 'vitest';
import { roundTrip, roundTripPass } from '@/lib/audio/roundtrip';
import { keyLeaks, orthography, syllables } from '@/lib/qa/checks';
import { parseAlphabet, lessonWords } from '@/lib/alphabet/reference';
import { glossGreek, glossRussian, type GlossEntry } from '@/lib/speaking/glossary';

const ids = (text: string) => orthography('f', text, { unknownWords: null }).map((f) => f.check_id);

describe('ASR round-trip comparison (v6)', () => {
  it('ignores the ASR spelling of monosyllables (πού/που, ή/η) but keeps polysyllabic stress errors', () => {
    expect(roundTripPass(roundTrip('Πού είναι το σπίτι σου;', 'Που είναι το σπίτι σου.'))).toBe(true);
    expect(roundTripPass(roundTrip('Η τσάντα μου είναι εδώ.', 'Ή τσάντα μου είναι εδώ'))).toBe(true);
    const stress = roundTrip('Πότε έρχεσαι;', 'Ποτέ έρχεσαι;');
    expect(stress.accent_mismatches).toEqual(['πότε']);
    expect(roundTripPass(stress)).toBe(false);
  });
  it('reads ASR symbols and digits as the words of the script', () => {
    expect(roundTripPass(roundTrip('Τρία ευρώ το κιλό.', '3€/kg.'))).toBe(true);
    expect(roundTrip('Η δοκιμή θα διαρκέσει έξι εβδομάδες.', 'Η δοκιμή θα διαρκέσει 6 εβδομάδες.').wer).toBe(0);
  });
  it('a sentence the script repeats verbatim counts once when the ASR drops the repetition', () => {
    const m = roundTrip('Η Μαρία θα στείλει την αίτηση αύριο. Η Μαρία θα στείλει την αίτηση αύριο.', 'Η Μαρία θα στείλει την αίτηση αύριο.');
    expect(m.wer).toBe(0);
    expect(roundTrip('Καλημέρα. Καλημέρα. Τι κάνεις;', 'Καλημέρα.').wer).toBeGreaterThan(0.3);
  });
  it('reads clock times written by the ASR as the words of the script', () => {
    expect(roundTrip('Το μάθημα αρχίζει στις έξι και μισή το απόγευμα, στην αίθουσα πέντε.', 'Το μάθημα αρχίζει στις 6:30 το απόγευμα στην αίθουσα 5.').wer).toBe(0);
    expect(roundTrip('Στις επτά παρά τέταρτο.', 'Στις 6:45.').wer).toBe(0);
  });
  it('a dropped tail is a real failure', () => {
    expect(roundTripPass(roundTrip('Καλησπέρα σας. Είμαι η συντονίστρια του προγράμματος «Ανοιχτό Αρχείο».', 'Καλησπέρα σας.'))).toBe(false);
  });
});

describe('Greek orthography QA (v6)', () => {
  it('blocks a medial sigma at the end of a word and mixed scripts', () => {
    expect(ids('Ο καφεσ είναι ζεστός.')).toContain('ortho.final_sigma');
    expect(ids('Ο καφές είναι ζεστός.')).not.toContain('ortho.final_sigma');
    expect(ids('Το σπiτι είναι εδώ.')).toContain('ortho.mixed_script');
  });
  it('does not flag elisions, notation fragments or the enclitic double accent', () => {
    expect(ids('Δώσ’ μου το βιβλίο.')).not.toContain('ortho.final_sigma');
    expect(ids('Γράψτε τις καταλήξεις -ος, -ης.')).not.toContain('ortho.final_sigma');
    expect(ids('Το όνομά μου είναι Άννα.')).not.toContain('ortho.double_accent');
    expect(ids('Το όνομά είναι Άννα.')).toContain('ortho.double_accent');
  });
  it('QA 2.1: a gap before an enclitic, diacritic clitics and ordinal suffixes are not errors', () => {
    expect(ids('Περιμένω την απάντησή ___.')).not.toContain('ortho.double_accent');
    expect(orthography('answer[0]', 'ενημέρωσή', { unknownWords: null }).map((f) => f.check_id)).not.toContain('ortho.double_accent');
    const clitic = orthography('f', 'Ο γιατρός σάς είπε να περιμένετε.', { unknownWords: null }).find((f) => f.check_id === 'ortho.monosyllable_accent');
    expect(clitic?.severity).toBe('info');
    expect(ids('Στις αρχές του 20ού αιώνα.')).not.toContain('ortho.monosyllable_accent');
  });
  it('QA 2.1: a wrong form named on purpose in an explanation is information, not a spelling error', () => {
    const f = orthography('theory_ru', 'Изучаем γράφοντας, не «γράψοντας».', { unknownWords: new Set(['γράψοντας']) }).find((x) => x.check_id === 'ortho.spelling');
    expect(f?.severity).toBe('info');
    expect(orthography('theory_ru', 'Пишем γράψοντας.', { unknownWords: new Set(['γράψοντας']) }).find((x) => x.check_id === 'ortho.spelling')?.severity).toBe('warning');
  });
  it('QA 2.1: a key leak is the instruction naming the answer, not a text to analyse or a lemma hint', () => {
    expect(keyLeaks('Заполните только форму είμαι: Εγώ ___ φοιτητής.', 'είμαι')).toBe(true);
    expect(keyLeaks('Назовите причину, используя γιατί: Μένω σπίτι ___ είμαι άρρωστος.', 'γιατί')).toBe(true);
    expect(keyLeaks('Βλέπω τον ___ (φίλος).', 'φίλο')).toBe(false);
    expect(keyLeaks('Исправьте εδιαβάζαμε.', 'διαβάζαμε')).toBe(false);
    expect(keyLeaks('Найдите начало урока в строке: «Μάθημα: 18:00. Βιβλιοθήκη: 09:00–20:00».', '18:00')).toBe(false);
    expect(keyLeaks('Диагностика: «Αν είχα χρόνο τώρα, θα ερχόμουν». Условие относится к τώρα или χτες?', 'τώρα')).toBe(false);
    expect(keyLeaks('Ударный слог в θάλασσα: первый/второй/третий от начала?', 'первый')).toBe(false);
    // A reported-speech frame belongs to the text for analysis (who is «εγώ»?), not to the instruction.
    expect(keyLeaks('Ο Πάνος είπε: «Εγώ μένω εδώ». Кто живёт здесь?', 'ο Πάνος')).toBe(false);
    expect(keyLeaks('Ответьте: Πάνος. Ο Πάνος είπε: «Εγώ μένω εδώ».', 'Πάνος')).toBe(true);
  });
  it('counts syllables with digraphs and synizesis', () => {
    expect(syllables('παιδί')).toBe(2);
    expect(syllables('ευχαριστώ')).toBe(4);
  });
});

describe('alphabet reference is derived from the lesson theory only', () => {
  const theory = 'В греческом алфавите 24 буквы. Например, β называется βήτα, но в слове βάζο передаёт [v]. Буква σ имеет конечную форму ς: μέσα, κόσμος.\n\nПолный справочник пар и названий: Α α άλφα; Β β βήτα; Γ γ γάμμα; Δ δ δέλτα; Ε ε έψιλον; Ζ ζ ζήτα; Η η ήτα; Θ θ θήτα; Ι ι γιώτα; Κ κ κάππα; Λ λ λάμδα; Μ μ μι; Ν ν νι; Ξ ξ ξι; Ο ο όμικρον; Π π πι; Ρ ρ ρο; Σ σ/ς σίγμα; Τ τ ταυ; Υ υ ύψιλον; Φ φ φι; Χ χ χι; Ψ ψ ψι; Ω ω ωμέγα.\n\nΜπ в μπαμπάς даёт звонкое [b].';
  it('parses 24 letters with names, the final sigma and only stated sounds', () => {
    const r = parseAlphabet(theory, ['παιδί: αι → [e]']);
    expect(r.letters).toHaveLength(24);
    expect(r.letters.find((l) => l.lower === 'σ')).toMatchObject({ final: 'ς', name: 'σίγμα', sound: null });
    expect(r.letters.find((l) => l.lower === 'β')).toMatchObject({ sound: '[v]', examples: ['βάζο'] });
    expect(r.letters.find((l) => l.lower === 'θ')?.sound).toBeNull();
  });
  it('example words come from the lesson, never letter names or bare digraphs', () => {
    const words = lessonWords(theory, []);
    expect(words).toContain('μπαμπάς');
    const r = parseAlphabet(theory, []);
    for (const l of r.letters) for (const w of l.examples) { expect(words).toContain(w); expect([...w].length).toBeGreaterThanOrEqual(3); }
  });
});

describe('course glossary help (no generation)', () => {
  const g: GlossEntry[] = [
    { lemma: 'σαλάτα', meaning_ru: 'салат', example: 'Θέλω μια σαλάτα.', unit_id: 'U1', unit_title: 'Кафе' },
    { lemma: 'τυρί', meaning_ru: 'сыр', example: null, unit_id: 'U1', unit_title: 'Кафе' },
    { lemma: 'καλώς ήρθατε', meaning_ru: 'добро пожаловать', example: null, unit_id: 'U2', unit_title: 'Встреча' },
  ];
  it('glosses Greek words of a line, accent- and inflection-tolerant', () => {
    expect(glossGreek('Καλώς ήρθατε! Θέλετε σαλάτες;', g).map((x) => x.lemma)).toEqual(['σαλάτα', 'καλώς ήρθατε']);
  });
  it('answers «как сказать» only from authored meanings', () => {
    expect(glossRussian('как сказать сыр', g).map((x) => x.lemma)).toEqual(['τυρί']);
    expect(glossRussian('как сказать вертолёт', g)).toEqual([]);
  });
});
