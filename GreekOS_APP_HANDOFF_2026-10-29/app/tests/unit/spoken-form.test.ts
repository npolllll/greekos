import { describe, expect, it } from 'vitest';
import { spokenForm } from '@/lib/audio/spoken-form';

/** Spoken form for the voice (probe 15.11.2026: Azure spelled these forms as letter names). */
describe('spoken form for Greek TTS', () => {
  it('joins elided γι’ and στ’ with the next word', () => {
    expect(spokenForm('Δεν βρήκε εισιτήριο. Γι’ αυτό θα έρθει αύριο.')).toBe('Δεν βρήκε εισιτήριο. Γιαυτό θα έρθει αύριο.');
    expect(spokenForm("γι' αυτό")).toBe('γιαυτό');
    expect(spokenForm('Ήταν στ’ αλήθεια ειδικός;')).toBe('Ήταν σταλήθεια ειδικός;');
  });
  it('leaves other elisions and words alone', () => {
    expect(spokenForm('Δώσ’ τα στη Νίκη, παρακαλώ.')).toBe('Δώσ’ τα στη Νίκη, παρακαλώ.');
    expect(spokenForm('Για αυτό το θέμα.')).toBe('Για αυτό το θέμα.');
    expect(spokenForm('Η γιαγιά μου.')).toBe('Η γιαγιά μου.');
    expect(spokenForm('Το όνομά σας, παρακαλώ;')).toBe('Το όνομά σας, παρακαλώ;');
  });
  it('removes the second accent only for words the voice mis-stressed', () => {
    expect(spokenForm('Αλλά η συνάδελφός μου εργάζεται.')).toBe('Αλλά η συνάδελφος μου εργάζεται.');
  });
});
