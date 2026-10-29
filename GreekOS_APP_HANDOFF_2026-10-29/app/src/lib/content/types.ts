/** Normalised item envelope as imported from HANDOFF_IMPORT/items.json (server-only). */
export interface ItemEnvelope {
  item_id: string;
  version: string;
  prompt: string;
  type: string;
  module: 'core' | 'keg_b2' | 'pegp' | 'real_greek' | 'synthetic_fixture';
  unit_id: string | null;
  level: string | null;
  canonical: { path: string; sha256: string };
  stimulus: unknown;
  model_response: unknown;
  rubric: string | Record<string, unknown> | null;
  estimated_effort: number | null;
  requires_audio: boolean;
  original_payload: Record<string, unknown>;
  competency_ids: string[];
  prerequisite_ids: string[];
  source_claim_ids: string[];
  audio_job_ids: string[];
  options: unknown[] | Record<string, unknown>;
  answer: unknown[];
  accepted_alternatives: unknown[];
  criteria: string[];
  error_tags: string[] | null;
  scoring: {
    strategy: ScoringStrategy;
    policy: Record<string, unknown>;
    automatic_final_score_allowed: false;
    unlisted_answer: 'HOLD_FOR_REVIEW_NO_PENALTY';
  };
  release: { state: 'CONTENT_GATED'; learner_access: false; automatic_mastery: false; review_required: true };
}

export type ScoringStrategy =
  | 'REVIEW_REQUIRED'
  | 'CHOICE_KEY'
  | 'EXACT_WITH_REVIEW_FALLBACK'
  | 'STRUCTURED_WITH_REVIEW_FALLBACK'
  | 'JOINT_BANK_REVIEW';

export type Verdict =
  | 'CORRECT'
  | 'ACCEPTABLE_VARIANT'
  | 'INCORRECT_CONFIRMED'
  | 'AMBIGUOUS'
  | 'ASR_UNCERTAIN'
  | 'UNSUPPORTED'
  | 'PENDING_REVIEW'
  | 'ABSTAIN'
  | 'NOT_ASSESSED';

export type ResponseKind = 'choice' | 'short_text' | 'structured_text' | 'open_text';

/** Explicit renderer adapters per item.schema.json type. Anything else fails closed. */
export const TYPE_ADAPTER: Record<string, ResponseKind> = {
  mcq: 'choice',
  multiple_choice: 'choice',
  meaning_in_context: 'choice',
  response: 'choice',
  short_answer: 'short_text',
  extra_word: 'short_text',
  error_correction: 'short_text',
  reading_detail: 'short_text',
  reading_reference: 'short_text',
  reading_inference: 'short_text',
  multiple_assignment: 'short_text',
  matching: 'structured_text',
  ordering: 'structured_text',
  open_response: 'open_text',
  production: 'open_text',
  writing_transfer: 'open_text',
  register_switch: 'open_text',
  spoken_interaction: 'open_text',
  D7_recall: 'open_text',
  D28_transfer: 'open_text',
  retention: 'open_text',
};

export function adapterFor(type: string, options: unknown): ResponseKind | null {
  const kind = TYPE_ADAPTER[type];
  if (!kind) return null;
  // 'response' / 'meaning_in_context' without options are free production.
  if (kind === 'choice' && !hasOptions(options)) return type === 'mcq' || type === 'multiple_choice' ? null : 'open_text';
  return kind;
}

export function hasOptions(options: unknown): boolean {
  if (Array.isArray(options)) return options.length > 0;
  return !!options && typeof options === 'object' && Object.keys(options).length > 0;
}

/** Choice options with stable keys preserved (array index or keyed map). */
export function choiceOptions(options: unknown): Array<{ key: string; label: string }> {
  if (Array.isArray(options)) return options.map((o, i) => ({ key: String(i), label: typeof o === 'string' ? o : JSON.stringify(o) }));
  if (options && typeof options === 'object') {
    return Object.entries(options as Record<string, unknown>).map(([k, v]) => ({ key: k, label: typeof v === 'string' ? v : k }));
  }
  return [];
}

export type TaskKind = 'recognition' | 'controlled' | 'spontaneous' | 'retention' | 'transfer';

export function taskKindFor(type: string, section: string | null): TaskKind {
  if (section === 'transfer') return 'transfer';
  if (section === 'retention' || type === 'D7_recall' || type === 'D28_transfer' || type === 'retention') return 'retention';
  const kind = TYPE_ADAPTER[type];
  if (kind === 'choice') return 'recognition';
  if (kind === 'open_text') return 'spontaneous';
  return 'controlled';
}
