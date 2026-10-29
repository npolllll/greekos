import { adapterFor, choiceOptions, type ItemEnvelope, type ResponseKind } from './types.ts';

/**
 * Candidate DTO: an allowlist of learner-visible fields. Keys, accepted alternatives, model
 * answers, rationale, original_payload, rubric internals and editor notes are never copied.
 */
export interface ItemDTO {
  item_id: string;
  content_hash: string;
  module: string;
  type: string;
  level: string | null;
  response_kind: ResponseKind;
  prompt: string;
  options: Array<{ key: string; label: string }>;
  stimulus: StimulusDTO | null;
  criteria_ru: string[];
  requires_audio: boolean;
  audio: { status: 'available'; asset_id: string; synthetic: true; dev_only?: true } | { status: 'unavailable'; reason: string } | null;
  format_hint_ru: string | null;
  spoken_task: boolean;
}

export interface StimulusDTO {
  kind: 'text' | 'inline' | 'audio_cue';
  text_id?: string;
  text?: string;
  title?: string;
  phrase_bank?: Record<string, string> | string[];
  word_bank?: string[];
  example?: { gap: string | number; filled: string } | null;
  segments?: Array<{ label: string; text: string }>;
  focus?: Record<string, string | number>;
}

const TEXT_FIELDS = ['text', 'original_text_el', 'text_el'] as const;

/** Whitelist resolution of stimulus.text_id objects (never the whole packet). */
export function publicTextObject(obj: Record<string, unknown> | null | undefined): Omit<StimulusDTO, 'kind'> | null {
  if (!obj || typeof obj !== 'object') return null;
  const textField = TEXT_FIELDS.find((f) => typeof obj[f] === 'string');
  if (!textField) return null;
  const out: Omit<StimulusDTO, 'kind'> = { text: obj[textField] as string };
  if (typeof obj.title === 'string') out.title = obj.title;
  if (obj.phrase_bank && typeof obj.phrase_bank === 'object') out.phrase_bank = obj.phrase_bank as Record<string, string>;
  if (Array.isArray(obj.word_bank)) out.word_bank = (obj.word_bank as unknown[]).filter((w): w is string => typeof w === 'string');
  const ex = obj.example as { gap?: unknown; answer?: unknown } | undefined;
  // The printed "(0)" example is part of the candidate paper, not a scored key.
  if (ex && (ex.gap === 0 || ex.gap === '0') && typeof ex.answer === 'string') out.example = { gap: ex.gap as number, filled: ex.answer };
  if (Array.isArray(obj.segments)) {
    out.segments = (obj.segments as Array<Record<string, unknown>>)
      .filter((s) => typeof s?.text === 'string')
      .map((s) => ({ label: String(s.label ?? ''), text: s.text as string }));
  }
  return out;
}

function formatHint(type: string): string | null {
  if (type === 'matching') return 'Запишите пары через запятую, например: 1-Α, 2-Β';
  if (type === 'ordering') return 'Запишите буквы по порядку через запятую, например: Β, Α';
  if (type === 'extra_word') return 'Впишите одно лишнее слово';
  return null;
}

const SPOKEN = new Set(['spoken_interaction', 'D7_recall', 'D28_transfer']);

export function buildItemDTO(params: {
  item: ItemEnvelope;
  contentHash: string;
  textObject?: Record<string, unknown> | null;
  audio?: ItemDTO['audio'];
  examMode?: boolean;
}): ItemDTO {
  const { item } = params;
  const kind = adapterFor(item.type, item.options);
  if (!kind) {
    const err = new Error(`UNSUPPORTED_CONTENT_TYPE ${item.type}`) as Error & { code: string };
    err.code = 'UNSUPPORTED_CONTENT_TYPE';
    throw err;
  }
  let stimulus: StimulusDTO | null = null;
  const st = item.stimulus as Record<string, unknown> | string | null;
  if (typeof st === 'string' && st.trim()) {
    stimulus = { kind: 'inline', text: st };
  } else if (st && typeof st === 'object') {
    if (typeof st.text_id === 'string') {
      const pub = publicTextObject(params.textObject);
      stimulus = pub ? { kind: 'text', text_id: st.text_id, ...pub } : null;
      const focus: Record<string, string | number> = {};
      for (const k of ['gap', 'target_segment']) if (typeof st[k] === 'string' || typeof st[k] === 'number') focus[k] = st[k] as string | number;
      if (stimulus && Object.keys(focus).length) stimulus.focus = focus;
    } else if (typeof st.asset_id === 'string') {
      // Listening cue: the transcript is NEVER substituted for missing audio.
      const focus: Record<string, string | number> = {};
      for (const k of ['cue_id', 'comparison_row']) if (typeof st[k] === 'string' || typeof st[k] === 'number') focus[k] = st[k] as string | number;
      stimulus = { kind: 'audio_cue', focus };
    }
  }
  return {
    item_id: item.item_id,
    content_hash: params.contentHash,
    module: item.module,
    type: item.type,
    level: item.level,
    response_kind: kind,
    prompt: item.prompt,
    options: kind === 'choice' ? choiceOptions(item.options) : [],
    stimulus,
    criteria_ru: params.examMode ? [] : (item.criteria ?? []).filter((c): c is string => typeof c === 'string'),
    requires_audio: item.requires_audio,
    audio: item.requires_audio ? params.audio ?? { status: 'unavailable', reason: 'AUDIO_PENDING' } : null,
    format_hint_ru: formatHint(item.type),
    spoken_task: SPOKEN.has(item.type),
  };
}

/** Defence in depth: assert a DTO carries no forbidden keys before it leaves the server. */
const FORBIDDEN = ['answer', 'accepted_alternatives', 'model_response', 'original_payload', 'rationale', 'canonical_answers', 'accepted_variants', 'completed_text_reviewer_only', 'scoring', 'error_tags', 'source_claim_ids'];
export function assertNoLeak(value: unknown, path = '$'): void {
  if (Array.isArray(value)) { value.forEach((v, i) => assertNoLeak(v, `${path}[${i}]`)); return; }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN.includes(k)) throw new Error(`DTO leak: ${path}.${k}`);
      assertNoLeak(v, `${path}.${k}`);
    }
  }
}
