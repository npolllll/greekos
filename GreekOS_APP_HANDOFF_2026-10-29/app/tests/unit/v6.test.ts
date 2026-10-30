import { describe, expect, it } from 'vitest';
import { roundTrip, roundTripPass } from '@/lib/audio/roundtrip';
import { orthography, syllables } from '@/lib/qa/checks';
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
