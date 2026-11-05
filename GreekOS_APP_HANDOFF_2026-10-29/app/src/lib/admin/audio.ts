import type { AudioJobRow } from '../audio/pipeline.ts';

type RawSegment = { segment_id?: string; cue_id?: string; speaker_role?: string; speaker?: string; text_el?: string; text?: string };

/**
 * Normalises the two segment shapes present in AUDIO_EXECUTION_PACK (course: segment_id/speaker_role/text_el;
 * exam L01–L03: cue_id/speaker/text) into the pipeline's AudioJobRow shape. Text is never altered.
 */
export function normalizeAudioJob(row: { audio_id: string; script_hash: string; text_el: string | null; segments: unknown; payload: Record<string, unknown> }): AudioJobRow {
  const segs = Array.isArray(row.segments) ? (row.segments as RawSegment[]) : [];
  return {
    audio_id: row.audio_id,
    script_hash: row.script_hash,
    text_el: row.text_el,
    payload: row.payload,
    segments: segs
      .map((s, i) => ({ segment_id: s.segment_id ?? s.cue_id ?? `${row.audio_id}-S${String(i + 1).padStart(2, '0')}`, speaker_role: s.speaker_role ?? s.speaker, text_el: s.text_el ?? s.text ?? '' }))
      .filter((s) => s.text_el.trim().length > 0),
  };
}
