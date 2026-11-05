/**
 * Words of the course that the el_GR hunspell dictionary lacks but that exist in Modern Greek. Each was
 * checked by the developer against its morphology and standard usage; colloquial and abbreviated forms
 * are marked. This list removes dictionary gaps from the spelling check — it is not a native review.
 * Deliberately wrong forms of exercises (εγράψα, εγραψά) are never added.
 */
export const LEXICON_ADDITIONS: Record<string, 'standard' | 'colloquial' | 'abbreviation' | 'variant'> = {
  // compounds and derivations of standard vocabulary
  ξαναμάθαμε: 'standard', // aorist of ξαναμαθαίνω
  προσβασιμότητα: 'standard', // accessibility
  χρήστρια: 'standard', // feminine of χρήστης
  χρονογραμμή: 'standard', // timeline
  φιλαναγνωσία: 'standard', // love of reading (φίλος + ανάγνωση), standard in Greek education
  φιλαναγνωσίας: 'standard', // genitive of φιλαναγνωσία
  εθνοτική: 'standard', // ethnic (εθνοτικός)
  πευκόμελο: 'standard', // pine honey
  πευκόμελου: 'standard',
  νωρίτερη: 'standard', // comparative adjective (νωρίτερη ώρα)
  αμαξίδιο: 'standard', // wheelchair
  πρόσθεσα: 'standard', // aorist of προσθέτω
  ιστολόγιο: 'standard', // blog
  καταληπτότητα: 'standard', // comprehensibility
  καταληπτότητας: 'standard',
  αυτοδιόρθωση: 'standard', // self-correction
  αυτοδιόρθωσης: 'standard',
  θεματοποίηση: 'standard', // thematisation
  επίρριψη: 'standard', // attribution (of blame)
  προκρατημένη: 'standard', // pre-booked (προκράτηση)
  πλυμένη: 'standard', // participle of πλένω (πλυμένος, -η, -ο)
  // café words of the scenes (loanwords in everyday use)
  φρέντο: 'standard', // iced coffee (φρέντο εσπρέσο / καπουτσίνο)
  λάτε: 'standard',
  μοκατσίνο: 'standard',
  φρεντοτσίνο: 'standard',
  // spoken Greek of the «Живой греческий» module
  καρντάσι: 'colloquial', // «brother, mate» (Northern Greek slang, from Turkish)
  ντεμέκ: 'colloquial', // «supposedly» (slang)
  // spelling variants and notation
  κάππα: 'variant', // name of the letter Κ (also κάπα)
  πληθ: 'abbreviation', // πληθ. = πληθυντικός in inflection notes
};
