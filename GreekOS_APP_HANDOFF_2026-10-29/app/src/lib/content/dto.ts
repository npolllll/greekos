import { adapterFor, choiceOptions, type ItemEnvelope, type ResponseKind } from './types.ts';
import { displaySpacing, restorePunctuationSpacing } from './spacing.ts';

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
  audio: { status: 'available'; asset_id: string; synthetic: true; dev_only?: true; qa?: 'verified' | 'needs_review' } | { status: 'unavailable'; reason: string } | null;
  format_hint_ru: string | null;
  spoken_task: boolean;
  /** «Who said it?» items: every speaker of the referenced recording (not the key). */
  speaker_choices?: string[];
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
  /** The summary with gaps that a «fill the summary» task is about (shown under the source text). */
  summary?: { text: string };
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
  if (type === 'multiple_assignment') return 'Кто это говорит? Выберите говорящего из записи';
  return null;
}

const SPOKEN = new Set(['spoken_interaction', 'D7_recall', 'D28_transfer']);

export function buildItemDTO(params: {
  item: ItemEnvelope;
  contentHash: string;
  textObject?: Record<string, unknown> | null;
  /** The object named by `stimulus.summary_id` (a gapped summary of the text). */
  summaryObject?: Record<string, unknown> | null;
  audio?: ItemDTO['audio'];
  examMode?: boolean;
  speakers?: string[];
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
      // «Fill gap (n) of the summary»: the gapped summary is shown with the text (before 15.11 it was not).
      const summary = typeof st.summary_id === 'string' ? publicTextObject(params.summaryObject)?.text : undefined;
      if (stimulus && summary) stimulus.summary = { text: summary };
    } else if (typeof st.asset_id === 'string') {
      // Listening cue: the transcript is NEVER substituted for missing audio.
      const focus: Record<string, string | number> = {};
      for (const k of ['cue_id', 'comparison_row']) if (typeof st[k] === 'string' || typeof st[k] === 'number') focus[k] = st[k] as string | number;
      stimulus = { kind: 'audio_cue', focus };
    } else if (st.display_policy !== 'AFTER_ATTEMPT_ONLY') {
      // A text written into the task ({ text }, { text, origin }, { text_el }): the reading text itself.
      // A transcript marked AFTER_ATTEMPT_ONLY stays hidden — it would give away a listening answer.
      const inline = typeof st.text === 'string' ? st.text : typeof st.text_el === 'string' ? st.text_el : null;
      if (inline?.trim()) stimulus = { kind: 'inline', text: inline };
    }
  }
  return {
    item_id: item.item_id,
    content_hash: params.contentHash,
    module: item.module,
    type: item.type,
    level: item.level,
    response_kind: kind,
    // Russian instructions lost spaces after commas on import (U-A2-014/015); restored for display only.
    prompt: restorePunctuationSpacing(item.prompt),
    options: kind === 'choice' ? choiceOptions(item.options) : [],
    stimulus,
    // Imported criteria lost spaces around numbers («комната2»); shown with them restored.
    criteria_ru: params.examMode ? [] : (item.criteria ?? []).filter((c): c is string => typeof c === 'string').map(displaySpacing),
    requires_audio: item.requires_audio,
    audio: item.requires_audio ? params.audio ?? { status: 'unavailable', reason: 'AUDIO_PENDING' } : null,
    format_hint_ru: formatHint(item.type),
    spoken_task: SPOKEN.has(item.type),
    ...(item.type === 'multiple_assignment' && params.speakers?.length ? { speaker_choices: params.speakers } : {}),
  };
}

/** Defence in depth: assert a DTO carries no forbidden keys before it leaves the server. */
const FORBIDDEN = ['answer', 'accepted_alternatives', 'model_response', 'original_payload', 'rationale', 'answer_explanation_ru', 'canonical_answers', 'accepted_variants', 'completed_text_reviewer_only', 'scoring', 'error_tags', 'source_claim_ids'];
export function assertNoLeak(value: unknown, path = '$'): void {
  if (Array.isArray(value)) { value.forEach((v, i) => assertNoLeak(v, `${path}[${i}]`)); return; }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN.includes(k)) throw new Error(`DTO leak: ${path}.${k}`);
      assertNoLeak(v, `${path}.${k}`);
    }
  }
}
