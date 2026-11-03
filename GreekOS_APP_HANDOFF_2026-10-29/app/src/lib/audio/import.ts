/**
 * Import of a finished recording for one audio job (a studio, a voice actor or a cloud TTS run made
 * outside this app). The file goes through the same digital QA as a local render — technical checks,
 * loudness normalisation (the master is kept), ASR round-trip against the job's script — and enters
 * the owner's listening/rights/release queue. Nothing is released by importing; rights stay pending
 * until the owner records the provider's terms.
 */
import { createHash } from 'node:crypto';
import { adminClient } from '../supabase/admin.ts';
import { analyzeWav, normalizeLoudness, parseWav } from './wav.ts';
import { alignmentDiff, roundTrip, roundTripPass } from './roundtrip.ts';
import { asrEngine, scriptSegments, setJobStatus } from './pipeline.ts';

export const IMPORT_VERSION = 'greekos-import/1.0';

export interface ImportMeta {
  /** Who produced the audio (studio, provider, voice actor). */
  provider: string;
  /** Speaker role → voice / performer name, as declared by the producer. */
  voices: Record<string, string>;
  /** Declared presentation per speaker role (owner's statement about the recording). */
  presentations?: Record<string, 'female' | 'male'>;
  note?: string | null;
}

export type ImportResult =
  | { ok: true; asset_id: string; digital_status: 'AUDIO_VERIFIED_DIGITAL' | 'NEEDS_REVIEW' | 'BLOCKED'; technical_pass: boolean; roundtrip: { cer_phonetic: number; wer: number; pass: boolean } | null }
  | { ok: false; error: 'NOT_FOUND' | 'NOT_WAV' | 'STALE' | 'UPLOAD'; message: string };

export async function importJobAudio(audioId: string, bytes: Uint8Array, meta: ImportMeta, actorId: string | null): Promise<ImportResult> {
  const db = adminClient();
  const { data: job } = await db.from('audio_jobs').select('audio_id, script_hash, text_el, segments').eq('audio_id', audioId).maybeSingle();
  if (!job) return { ok: false, error: 'NOT_FOUND', message: 'Задание не найдено' };
  if (!parseWav(bytes)) return { ok: false, error: 'NOT_WAV', message: 'Нужен несжатый WAV (PCM 16 бит).' };

  const norm = normalizeLoudness(bytes);
  const tech = analyzeWav(norm.wav, { allowedPauseMs: 3500 });
  const technicalPass = !!tech?.pass;
  const segments = scriptSegments(job);
  const script = segments.length ? segments.map((s) => s.text).join(' ') : job.text_el ?? '';
  const asr = technicalPass ? await asrEngine().catch(() => null) : null;
  let rt: (ReturnType<typeof roundTrip> & { engine: string; hypothesis: string; diff: ReturnType<typeof alignmentDiff>; pass: boolean }) | null = null;
  if (asr && script) {
    try {
      const hyp = await asr.run(norm.wav, actorId);
      const m = roundTrip(script, hyp);
      rt = { ...m, engine: asr.engine, hypothesis: hyp, diff: alignmentDiff(script, hyp), pass: roundTripPass(m) };
    } catch {
      rt = null;
    }
  }
  const digital = !technicalPass ? 'BLOCKED' : rt?.pass ? 'AUDIO_VERIFIED_DIGITAL' : 'NEEDS_REVIEW';
  const renderStatus = !technicalPass ? 'TECH_QA_FAIL' : rt?.pass ? 'DIGITAL_REVIEWED' : 'LINGUISTIC_QA_PENDING';

  const sha = createHash('sha256').update(norm.wav).digest('hex');
  const masterSha = createHash('sha256').update(bytes).digest('hex');
  const deliveryPath = `${audioId}/${sha}.wav`;
  const masterPath = `${audioId}/master/${masterSha}.wav`;
  for (const [path, b] of [[deliveryPath, norm.wav], [masterPath, bytes]] as const) {
    const up = await db.storage.from('course-audio').upload(path, b, { contentType: 'audio/wav', upsert: true });
    if (up.error) return { ok: false, error: 'UPLOAD', message: up.error.message };
  }
  const { data: prev } = await db.from('audio_assets').select('id').eq('audio_id', audioId).is('invalidated_at', null);
  // The owner imports the file and declares who speaks each role: that declaration is the owner's casting.
  const roles = [...new Set(segments.map((s) => s.role).filter((r): r is string => !!r))];
  const castDeclared = !!actorId && roles.every((r) => meta.voices[r]?.trim() && meta.presentations?.[r]);
  const { data: inserted, error } = await db.from('audio_assets').insert({
    audio_id: audioId, script_hash: job.script_hash, idempotency_key: `import:${masterSha}`,
    provider: 'external_import', model: meta.provider.slice(0, 120), voice_map: meta.voices, voice_ids: [],
    cast_snapshot: { declared_presentations: meta.presentations ?? {}, voices: meta.voices, declared_by: actorId }, cast_approved: castDeclared, synthesis_version: IMPORT_VERSION,
    generation_params: { imported: true, producer: meta.provider, note: meta.note ?? null },
    object_path: deliveryPath, mime_type: 'audio/wav', sha256: sha, byte_length: norm.wav.byteLength,
    master_object_path: masterPath, master_sha256: masterSha, normalization: norm.report,
    duration_ms: tech?.duration_ms ?? null, sample_rate: tech?.sample_rate ?? null, channels: tech?.channels ?? null,
    // Cue times of a delivered mix are not known until measured: the segments are listed unmeasured.
    segment_cues: segments.map((s) => ({ segment_id: s.id, role: s.role, voice_id: null, start_ms: null, end_ms: null })),
    technical_status: technicalPass ? 'TECHNICAL_PASS' : 'TECHNICAL_FAIL', technical_report: tech,
    asr_roundtrip: rt, digital_status: digital, rights_status: 'RIGHTS_PENDING',
    rights_evidence: { basis: 'IMPORTED_FILE_TERMS_NOT_YET_RECORDED', producer: meta.provider, note: meta.note ?? null },
    render_status: renderStatus, created_by: actorId,
    history: [{ at: new Date().toISOString(), event: 'imported', producer: meta.provider, render_status: renderStatus, superseded: (prev ?? []).map((p) => p.id) }],
  }).select('id').single();
  if (error) {
    if (error.code === '23505') return { ok: false, error: 'STALE', message: 'Этот файл уже импортирован для задания.' };
    throw new Error(error.message);
  }
  const stale = (prev ?? []).map((p) => p.id).filter((id) => id !== inserted.id);
  if (stale.length) await db.from('audio_assets').update({ invalidated_at: new Date().toISOString(), invalidated_reason: 'SUPERSEDED_BY_IMPORT' }).in('id', stale);
  await db.from('digital_qa_runs').insert({
    content_kind: 'audio_asset', content_id: inserted.id, content_hash: sha, check_kind: 'DIGITAL_AUDIO_QA', tool_id: `${tech?.profile ?? 'n/a'}+${rt?.engine ?? 'no-asr'}`,
    verdict: renderStatus === 'DIGITAL_REVIEWED' ? 'PASS' : renderStatus === 'TECH_QA_FAIL' ? 'FAIL' : 'NEEDS_REVIEW', report: { technical: tech, roundtrip: rt, normalization: norm.report, imported: true }, run_by: actorId,
  });
  const jobStatus = renderStatus === 'TECH_QA_FAIL' ? 'TECH_QA_FAIL' : renderStatus === 'DIGITAL_REVIEWED' ? 'DIGITAL_REVIEWED' : 'TECH_QA_PASS';
  await setJobStatus(audioId, jobStatus, renderStatus === 'LINGUISTIC_QA_PENDING' ? (rt ? 'импортированный файл: распознавание расходится с текстом — нужен разбор' : 'импортированный файл: распознавание не выполнено') : null, { attempted: true, asset_id: inserted.id });
  return { ok: true, asset_id: inserted.id, digital_status: digital, technical_pass: technicalPass, roundtrip: rt ? { cer_phonetic: rt.cer_phonetic, wer: rt.wer, pass: rt.pass } : null };
}
