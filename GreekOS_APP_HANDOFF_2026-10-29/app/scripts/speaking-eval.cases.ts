/**
 * GreekOS speaking evaluation suite (v2: + 9 correction cases — 5 errors, 4 correct phrases). Each case is one learner turn in a real corpus scenario,
 * with what a competent interlocutor must do. Labels were written by the developer from Greek
 * grammar (not by a native reviewer); they test the engine, they do not certify the language.
 */
export interface EvalCase {
  id: string;
  scenario: string;
  mode: 'roleplay' | 'free_talk' | 'b2_mock' | 'real_greek' | 'a0_guided' | 'course';
  level?: string;
  /** Conversation so far after the opening line: [speaker, text] (a = persona, l = learner). */
  history?: Array<['a' | 'l', string]>;
  node?: string;
  facts?: string[];
  learner: string;
  expect: {
    stages?: string[];
    feedback: 'issue' | 'none' | 'skip';
    better_any?: string[];
    reply_not?: string[];
    reply_any?: string[];
    question?: boolean;
    max_words?: number;
    no_hint?: boolean;
  };
}

const TWIST_SC01: Array<['a' | 'l', string]> = [['l', 'Θέλω ένα κιλό μήλα.'], ['a', 'Τα μήλα τελείωσαν. Έχουμε αχλάδια με δύο ευρώ το κιλό. Θέλετε;']];

export const SUITE = 'greekos-speaking-eval/2';

export const CASES: EvalCase[] = [
  { id: 'sc01-request', scenario: 'SC01', mode: 'roleplay', learner: 'Καλημέρα. Θέλω ένα κιλό μήλα, παρακαλώ.', expect: { stages: ['TWIST'], feedback: 'none' } },
  { id: 'sc01-plural-error', scenario: 'SC01', mode: 'roleplay', learner: 'Θέλω δύο κιλό πορτοκάλι.', expect: { stages: ['TWIST', 'OPEN'], feedback: 'issue', better_any: ['κιλά', 'πορτοκάλια'], reply_not: ['κιλό πορτοκάλι'] } },
  { id: 'sc01-russian', scenario: 'SC01', mode: 'roleplay', learner: 'Я не понимаю, что вы сказали.', expect: { stages: ['OPEN', 'REPAIR'], feedback: 'skip' } },
  { id: 'sc01-slower', scenario: 'SC01', mode: 'roleplay', learner: 'Δεν κατάλαβα. Μπορείτε να το πείτε πιο αργά;', expect: { stages: ['REPAIR', 'OPEN'], feedback: 'none' } },
  { id: 'sc01-twist-accept', scenario: 'SC01', mode: 'roleplay', node: 'TWIST', history: TWIST_SC01, learner: 'Ναι, μισό κιλό αχλάδια, παρακαλώ.', expect: { stages: ['NEGOTIATE'], feedback: 'none' } },
  { id: 'sc01-twist-refuse', scenario: 'SC01', mode: 'roleplay', node: 'TWIST', history: TWIST_SC01, learner: 'Όχι, ευχαριστώ. Δεν θέλω αχλάδια.', expect: { stages: ['NEGOTIATE', 'TWIST'], feedback: 'none' } },
  {
    id: 'sc01-memory-total', scenario: 'SC01', mode: 'roleplay', node: 'NEGOTIATE',
    history: [...TWIST_SC01, ['l', 'Ναι, μισό κιλό αχλάδια, παρακαλώ.'], ['a', 'Θα πληρώσετε με κάρτα ή μετρητά;']],
    facts: ['Яблок нет', 'Груши: 2 евро за кг', 'Покупатель берёт полкило груш'],
    learner: 'Πόσο κάνουν όλα μαζί;', expect: { stages: ['NEGOTIATE', 'CLOSE'], feedback: 'none', reply_any: ['ένα ευρώ', '1 ευρώ', '1€', '1 €'] },
  },
  { id: 'sc05-article-error', scenario: 'SC05', mode: 'roleplay', learner: 'Θέλω ένα καφέ και ένα νερό.', expect: { stages: ['TWIST'], feedback: 'issue', better_any: ['έναν καφέ'] } },
  { id: 'sc05-correct', scenario: 'SC05', mode: 'roleplay', learner: 'Έναν μικρό καφέ, παρακαλώ.', expect: { stages: ['TWIST'], feedback: 'none' } },
  { id: 'sc07-request', scenario: 'SC07', mode: 'roleplay', learner: 'Θέλω να κλείσω ραντεβού. Τι έγγραφα χρειάζομαι;', expect: { stages: ['TWIST'], feedback: 'none' } },
  { id: 'sc07-verb-error', scenario: 'SC07', mode: 'roleplay', learner: 'Εγώ θέλει να ρωτάω για τα έγγραφα.', expect: { stages: ['TWIST', 'OPEN'], feedback: 'issue', better_any: ['θέλω'], reply_not: ['θέλει να ρωτάω'] } },
  { id: 'sc12-request', scenario: 'SC12', mode: 'roleplay', learner: 'Τι μπορώ να κάνω; Πρέπει να είμαι στο κέντρο στις τρεις.', expect: { stages: ['TWIST'], feedback: 'none' } },
  { id: 'sc12-modal-error', scenario: 'SC12', mode: 'roleplay', learner: 'Πώς πάω τώρα στο κέντρο; Πρέπει φτάνω πριν τις τρεις.', expect: { stages: ['TWIST', 'OPEN'], feedback: 'issue', better_any: ['πρέπει να φτάσω', 'Πρέπει να φτάσω', 'πρέπει να φτάνω'] } },
  { id: 'sc14-b2-problem', scenario: 'SC14', mode: 'roleplay', learner: 'Ναι, δεν κλείνει καλά και όταν βρέχει μπαίνει νερό στο σαλόνι. Θα ήθελα να έρθει κάποιος το συντομότερο.', expect: { stages: ['TWIST'], feedback: 'none' } },
  { id: 'sc14-b2-compromise', scenario: 'SC14', mode: 'roleplay', node: 'TWIST', history: [['l', 'Το παράθυρο δεν κλείνει και μπαίνει νερό.'], ['a', 'Ο τεχνικός μπορεί μόνο την Παρασκευή, όταν λείπετε.']], learner: 'Την Παρασκευή δουλεύω, αλλά μπορώ να αφήσω το κλειδί στη γειτόνισσά μου.', expect: { stages: ['NEGOTIATE'], feedback: 'none' } },
  { id: 'sc16-question', scenario: 'SC16', mode: 'roleplay', learner: 'Ναι, δεν καταλαβαίνω αν πρέπει να παίρνω το φάρμακο πριν ή μετά το φαγητό.', expect: { stages: ['TWIST'], feedback: 'none' } },
  { id: 'sc31-opinion', scenario: 'SC31', mode: 'roleplay', learner: 'Νομίζω ότι σε ομάδα είναι καλύτερα, γιατί μαθαίνουμε ο ένας από τον άλλο.', expect: { stages: ['TWIST'], feedback: 'none' } },
  { id: 'free-life', scenario: 'SC24', mode: 'free_talk', learner: 'Μένω στη Θεσσαλονίκη δύο χρόνια και μου αρέσει πολύ η θάλασσα.', expect: { feedback: 'skip', question: true } },
  { id: 'free-case-error', scenario: 'SC24', mode: 'free_talk', learner: 'Χτες πήγα στο Λευκό Πύργο με τους φίλους μου.', expect: { feedback: 'issue', better_any: ['στον Λευκό Πύργο'], question: true } },
  { id: 'free-correct', scenario: 'SC24', mode: 'free_talk', learner: 'Το Σαββατοκύριακο μαγειρεύω με την οικογένειά μου.', expect: { feedback: 'none', question: true } },
  { id: 'rg-plan', scenario: 'RG-S01', mode: 'real_greek', learner: 'Πόσες λέξεις σκοπεύεις να μάθεις;', expect: { stages: ['B1', 'B2', 'B3'], feedback: 'none' } },
  { id: 'b2mock-no-hints', scenario: 'SC14', mode: 'b2_mock', learner: 'Το πρόβλημα είναι ότι το παράθυρο δεν κλείνει σωστά.', expect: { stages: ['TWIST', 'OPEN'], feedback: 'skip', no_hint: true } },
  { id: 'a0-short', scenario: 'SC01', mode: 'a0_guided', level: 'A0', learner: 'Μήλα, παρακαλώ.', expect: { stages: ['TWIST', 'OPEN'], feedback: 'none', max_words: 14 } },
  { id: 'a0-russian', scenario: 'SC05', mode: 'a0_guided', level: 'A0', learner: 'Кофе, пожалуйста.', expect: { stages: ['OPEN', 'REPAIR', 'TWIST'], feedback: 'skip', max_words: 14 } },
  // v2: corrections — errors the rules catch and errors only the model can, and correct phrases that must stay untouched.
  { id: 'sc12-se-article', scenario: 'SC12', mode: 'roleplay', learner: 'Πρέπει να πάω σε το νοσοκομείο. Ποιο λεωφορείο πάει εκεί;', expect: { feedback: 'issue', better_any: ['στο νοσοκομείο', 'στο'] } },
  { id: 'sc05-pronoun-verb', scenario: 'SC05', mode: 'roleplay', learner: 'Εγώ πίνει καφέ χωρίς ζάχαρη.', expect: { feedback: 'issue', better_any: ['πίνω'] } },
  { id: 'sc01-number-plural', scenario: 'SC01', mode: 'roleplay', learner: 'Θέλω τρία μήλο και δύο αχλάδι.', expect: { feedback: 'issue', better_any: ['τρία μήλα', 'μήλα', 'δύο αχλάδια'] } },
  { id: 'sc07-masc-article', scenario: 'SC07', mode: 'roleplay', learner: 'Θέλω να μιλήσω με το διευθυντή, παρακαλώ.', expect: { feedback: 'issue', better_any: ['τον διευθυντή'] } },
  { id: 'free-subject-verb', scenario: 'SC24', mode: 'free_talk', learner: 'Οι φίλοι μου μένει στην Αθήνα και εγώ μένω εδώ.', expect: { feedback: 'issue', better_any: ['μένουν'], question: true } },
  { id: 'sc05-correct-2', scenario: 'SC05', mode: 'roleplay', learner: 'Έναν φρέντο εσπρέσο χωρίς ζάχαρη, παρακαλώ.', expect: { feedback: 'none' } },
  { id: 'sc12-correct', scenario: 'SC12', mode: 'roleplay', learner: 'Πώς μπορώ να πάω στον σταθμό;', expect: { feedback: 'none' } },
  { id: 'free-correct-2', scenario: 'SC24', mode: 'free_talk', learner: 'Χθες πήγαμε στη θάλασσα και φάγαμε ψάρι.', expect: { feedback: 'none', question: true } },
  { id: 'sc07-correct-2', scenario: 'SC07', mode: 'roleplay', learner: 'Χρειάζομαι το διαβατήριο και μια φωτογραφία;', expect: { feedback: 'none' } },
  { id: 'sc05-gender-error', scenario: 'SC05', mode: 'roleplay', node: 'NEGOTIATE', history: [['l', 'Έναν καφέ, παρακαλώ.'], ['a', 'Μικρό ποτήρι δεν έχουμε. Θέλετε μεγάλο στην ίδια τιμή;'], ['l', 'Ναι, μεγάλο.'], ['a', 'Θα μείνετε εδώ ή θα τα πάρετε μαζί σας;']], learner: 'Θα μείνω εδώ. Περιμένω μια φίλος στις πέντε.', expect: { stages: ['CLOSE', 'NEGOTIATE'], feedback: 'issue', better_any: ['μια φίλη', 'έναν φίλο', 'ένα φίλο', 'μία φίλη'] } },
];
