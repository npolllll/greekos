/**
 * ΠΕΓΠ completion, 14.11.2026 (prepared with AI assistance, not reviewed by a teacher or the rights holder).
 *
 * 1. Twenty language-support tasks (P04–P06) are GreekOS's own texts and questions, built on facts from the
 *    official bank cited by page — but their task files had no rights record. The record documents exactly
 *    that provenance; it is added only while the task still points to its original GreekOS stimulus.
 * 2. Packet P06 was marked unfinished: its history tasks needed portraits whose image rights are not
 *    cleared, and its language production / delayed tasks were not written. Own alternatives are added:
 *    text-only history tasks (no images, facts of general record, not matched to bank pages 22–25) and the
 *    four production / D7 / D28 tasks on the packet's own text, in the same format as P04 and P05.
 * 3. Packet P01 (the exam format overview) carried a "republication rights" blocker: GreekOS does not
 *    republish the official bank, it links to it and trains on its own tasks — recorded as such.
 */
export const PEGP_LANG_RIGHTS_ITEMS: Record<string, string> = Object.fromEntries([
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => [`PEGP-LANG-P04-0${n}`, 'PEGP-LANG-P04-T01']),
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => [`PEGP-LANG-P05-0${n}`, 'PEGP-LANG-P05-T01']),
  ...[1, 2, 3, 4].map((n) => [`PEGP-LANG-P06-0${n}`, 'PEGP-LANG-P06-T01']),
]);

export const PEGP_LANG_LICENSING = {
  originator: 'GreekOS AI-assisted original authoring (PEGP language support)',
  allowed_uses: ['project editing', 'review', 'future project publication after QA'],
  license_type: 'ORIGINAL_PROJECT_CONTENT', derivative_allowed: true, third_party_assets: false,
  permission_evidence: 'Учебный текст, ситуация и вопросы написаны в проекте GreekOS; из официального банка ΠΕΓΠ взяты только факты со ссылкой на страницу; формулировки вопросов и изображения банка не воспроизводятся.',
  copyright_exclusivity_claimed: false, commercial_web_distribution_allowed: true,
  recorded_by: 'ai-assisted-content-revision/1.0 (14.11.2026), по происхождению стимула; юридическая экспертиза не проводилась',
};

const RUBRIC_LANG = {
  mastery: 'Ανεξάρτητη πρώτη προσπάθεια και νέα καθυστερημένη μεταφορά· το υπόδειγμα δεν είναι μοναδική λύση.',
  language_0_2: { 0: 'Το νόημα δεν γίνεται κατανοητό.', 1: 'Το νόημα γίνεται κατανοητό με προσπάθεια· υπάρχουν γλωσσικά λάθη.', 2: 'Κατανοητές συνδεδεμένες φράσεις κατάλληλες για τον συγκεκριμένο αποδέκτη· μικρά λάθη δεν αλλάζουν το νόημα.' },
  speaking_only: 'Προφορά μόνο από πραγματικό ήχο με ακουστική αξιολόγηση. Γραπτό/ASR κείμενο: NO_PRONUNCIATION_SCORE.',
};

export interface PegpNewItem {
  item_id: string;
  type: string;
  prompt: string;
  options?: string[];
  answer: string[];
  alternatives?: string[];
  explanation_ru: string;
  /** Production / delayed tasks: reviewed by rubric, never auto-scored. */
  review?: { task_0_2: Record<0 | 1 | 2, string>; model_response: string };
  fact_el?: string;
  stimulus_text_id?: string;
}

export const PEGP_P06_NEW_ITEMS: PegpNewItem[] = [
  {
    item_id: 'PEGP-P06-HIS-T01', type: 'mcq', fact_el: 'Ιωάννης Καποδίστριας',
    prompt: 'Ποιος ήταν ο πρώτος Κυβερνήτης του ελληνικού κράτους (1828–1831);',
    options: ['Ιωάννης Καποδίστριας', 'Ελευθέριος Βενιζέλος', 'Χαρίλαος Τρικούπης'], answer: ['Ιωάννης Καποδίστριας'],
    explanation_ru: 'Ιωάννης Καποδίστριας возглавил новое греческое государство в 1828 году как Κυβερνήτης и был убит в 1831-м. Βενιζέλος и Τρικούπης — премьер-министры более позднего времени.',
  },
  {
    item_id: 'PEGP-P06-HIS-T02', type: 'short_answer', fact_el: 'Θεόδωρος Κολοκοτρώνης',
    prompt: 'Ποιον αγωνιστή της Επανάστασης του 1821 αποκαλούσαν «Γέρο του Μοριά»; Γράψτε το επώνυμο.',
    answer: ['Κολοκοτρώνης'], alternatives: ['Θεόδωρος Κολοκοτρώνης', 'ο Κολοκοτρώνης', 'τον Κολοκοτρώνη', 'Ο Θεόδωρος Κολοκοτρώνης'],
    explanation_ru: '«Γέρος του Μοριά» («Старик Морей», то есть Пелопоннеса) — прозвище Θεόδωρος Κολοκοτρώνης, одного из главных военачальников революции 1821 года.',
  },
  {
    item_id: 'PEGP-P06-HIS-T03', type: 'mcq', fact_el: 'Λασκαρίνα Μπουμπουλίνα',
    prompt: 'Ποια ηρωίδα της Επανάστασης του 1821 από τις Σπέτσες ήταν πλοιοκτήτρια και πήρε μέρος στον αγώνα με το δικό της πλοίο;',
    options: ['Λασκαρίνα Μπουμπουλίνα', 'Μαντώ Μαυρογένους', 'Σοφία Βέμπο'], answer: ['Λασκαρίνα Μπουμπουλίνα'],
    explanation_ru: 'Λασκαρίνα Μπουμπουλίνα со Спеце снарядила собственные корабли (флагман «Αγαμέμνων»). Μαντώ Μαυρογένους — тоже героиня 1821 года, но с Миконоса; Σοφία Βέμπο — певица времён Второй мировой войны.',
  },
  {
    item_id: 'PEGP-P06-HIS-T04', type: 'short_answer', fact_el: 'Κρήτη',
    prompt: 'Ο Ελευθέριος Βενιζέλος γεννήθηκε σε ένα μεγάλο ελληνικό νησί. Σε ποιο;',
    answer: ['Κρήτη'], alternatives: ['στην Κρήτη', 'Στην Κρήτη', 'η Κρήτη'],
    explanation_ru: 'Ελευθέριος Βενιζέλος родился в 1864 году на Крите (Μουρνιές, близ Χανίων) и затем много раз был премьер-министром Греции.',
  },
  {
    item_id: 'PEGP-LANG-P06-05', type: 'writing_transfer', stimulus_text_id: 'PEGP-LANG-P06-T01', answer: [],
    prompt: 'Γράψτε ένα μήνυμα 40–60 λέξεων στην ομάδα μελέτης. Πείτε ότι θα έρθετε την Παρασκευή, γράψτε σωστά ένα νησί και μία ηπειρωτική περιοχή από το κείμενο και ρωτήστε αν μπορείτε να φέρετε δικές σας σημειώσεις. Μην παρουσιάσετε τη συνάντηση ως επίσημη εξέταση.',
    explanation_ru: 'Оцениваются адресат, подтверждение встречи, верная пара «остров — материк» из текста и вопрос о заметках. 40–60 слов — ориентир, не официальная норма.',
    review: { task_0_2: { 0: 'Δεν μεταδίδονται τα βασικά ζητούμενα ή αλλάζει κρίσιμο γεγονός.', 1: 'Μεταδίδεται μέρος των ζητουμένων ή χρειάζεται βοήθεια.', 2: 'Επιβεβαιώνει την Παρασκευή, δίνει ένα νησί και μία ηπειρωτική περιοχή σωστά, ρωτά για τις σημειώσεις και δεν τη λέει επίσημη εξέταση.' }, model_response: 'Γεια σας! Θα έρθω στη συνάντηση την Παρασκευή στις έξι στην αίθουσα δύο. Θυμάμαι ότι η Σίφνος ανήκει στη νησιωτική Ελλάδα, ενώ τα Γρεβενά στην ηπειρωτική. Μπορώ να φέρω και τις δικές μου σημειώσεις για το Νομισματικό Μουσείο; Τα λέμε!' },
  },
  {
    item_id: 'PEGP-LANG-P06-06', type: 'spoken_interaction', stimulus_text_id: 'PEGP-LANG-P06-T01', answer: [],
    prompt: 'Μιλήστε με ένα μέλος της ομάδας χωρίς να διαβάζετε έτοιμο κείμενο. Εκείνος λέει: «Η Σύρος είναι στην ηπειρωτική Ελλάδα, σωστά;» Διορθώστε τον ευγενικά, δώστε ένα δικό σας παράδειγμα και ρωτήστε τι θα κάνουμε μετά τα τοπωνύμια.',
    explanation_ru: 'Нужно вежливо исправить ошибку (Σύρος — островная Греция), привести свой пример и задать вопрос о следующем шаге встречи. Чтение готового ответа не считается самостоятельной речью.',
    review: { task_0_2: { 0: 'Δεν διορθώνεται το λάθος ή αλλάζει κρίσιμο γεγονός.', 1: 'Διορθώνει το λάθος, αλλά λείπει το παράδειγμα ή η ερώτηση, ή χρειάζεται βοήθεια.', 2: 'Διορθώνει ευγενικά (η Σύρος είναι νησί), δίνει σωστό δικό του παράδειγμα και ρωτά για το επόμενο βήμα.' }, model_response: 'Όχι ακριβώς· η Σύρος είναι νησί, ανήκει στη νησιωτική Ελλάδα. Στην ηπειρωτική είναι, για παράδειγμα, η Καρδίτσα. Μετά τα τοπωνύμια τι θα κάνουμε; Θα διαβάσουμε τη σημείωση για το μουσείο;' },
  },
  {
    item_id: 'PEGP-LANG-P06-07', type: 'D7_recall', stimulus_text_id: 'PEGP-LANG-P06-T01', answer: [],
    prompt: 'Επτά ημέρες αργότερα, χωρίς να ανοίξετε το κείμενο: πείτε δύο νησιά και δύο ηπειρωτικές περιοχές που μάθατε και εξηγήστε σε μία πρόταση γιατί η ομάδα δεν χρησιμοποίησε φωτογραφίες.',
    explanation_ru: 'Отложенная проверка (D7): воспроизведение без опоры — Σίφνος, Σύρος / Καρδίτσα, Γρεβενά — и причина отказа от фотографий (права на использование не проверены).',
    review: { task_0_2: { 0: 'Δεν μεταδίδονται τα βασικά ζητούμενα ή αλλάζει κρίσιμο γεγονός.', 1: 'Σωστό μέρος των τοπωνυμίων ή της αιτίας, ή με βοήθεια.', 2: 'Δύο νησιά και δύο ηπειρωτικές περιοχές σωστά και σωστή αιτία (δεν ελέγχθηκαν τα δικαιώματα χρήσης).' }, model_response: 'Η Σίφνος και η Σύρος είναι νησιά, ενώ η Καρδίτσα και τα Γρεβενά είναι στην ηπειρωτική Ελλάδα. Η ομάδα δεν χρησιμοποίησε φωτογραφίες, επειδή δεν είχε ελέγξει τα δικαιώματα χρήσης τους.' },
  },
  {
    item_id: 'PEGP-LANG-P06-08', type: 'D28_transfer', stimulus_text_id: 'PEGP-LANG-P06-T01', answer: [],
    prompt: 'Μετά από 28 ημέρες ένας φίλος σάς γράφει: «Η Σητεία και τα Γρεβενά είναι και τα δύο νησιά.» Απαντήστε του σε 2–3 προτάσεις: διορθώστε μόνο ό,τι είναι λάθος και προτείνετε να το ελέγξετε μαζί στο υλικό.',
    explanation_ru: 'Перенос через 28 дней (D28): Σητεία относится к островной Греции (Крит), Γρεβενά — к материковой; исправить нужно только неверную часть и предложить проверить по материалу.',
    review: { task_0_2: { 0: 'Δεν διορθώνεται το λάθος ή διορθώνεται λάθος στοιχείο.', 1: 'Διορθώνει μέρος ή χωρίς πρόταση ελέγχου.', 2: 'Κρατά τη Σητεία στη νησιωτική Ελλάδα, διορθώνει τα Γρεβενά (ηπειρωτική) και προτείνει κοινό έλεγχο.' }, model_response: 'Η Σητεία είναι πράγματι στη νησιωτική Ελλάδα, στην Κρήτη. Τα Γρεβενά όμως δεν είναι νησί· ανήκουν στην ηπειρωτική Ελλάδα. Αν θέλεις, να το ελέγξουμε μαζί στις σημειώσεις μας.' },
  },
];

export const PEGP_LANG_RUBRIC = RUBRIC_LANG;

/** P06: what the packet covers after completion, and what it deliberately leaves out (with the reason). */
export const P06_SCOPE = {
  status: 'AUTHORED_SCOPE_COMPLETE_NOT_HUMAN_REVIEWED',
  excluded_scope: [
    { what: 'Вопросы с портретами исторических лиц (стр. 22–25 банка)', reason: 'права на изображения не подтверждены', alternative: 'текстовые задания PEGP-P06-HIS-T01…T04 о ролях исторических лиц без изображений; соответствие конкретным страницам банка не сверялось' },
    { what: 'Институты, стр. 22 и далее', reason: 'в этом пакете не обрабатывались', alternative: 'институты тренируются в пакетах P02–P05' },
  ],
};
