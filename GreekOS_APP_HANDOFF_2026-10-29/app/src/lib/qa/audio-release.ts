import 'server-only';
import { z } from 'zod';
import { adminClient } from '../supabase/admin.ts';
import { audit } from '../audit.ts';
import { HttpError, type SessionUser } from '../session-user.ts';
import { sha256Hex, stableStringify } from '../content/stable-json.ts';

/**
 * v6 release path for synthesized course audio. A file reaches learners only when: it is the current
 * render of the current script, passed technical QA and the per-segment ASR round-trip
 * (AUDIO_VERIFIED_DIGITAL), its casting is approved, provider terms are recorded (DEV_LOCAL_ONLY never
 * qualifies), the owner listened to it and marked it OK — and the owner then decides under the signed
 * digital policy. The decision cites a QA snapshot batch, like content decisions do.
 */
export const ListenReview = z.object({ asset_id: z.string().uuid(), decision: z.enum(['OK', 'ISSUE']), note: z.string().trim().max(500).optional() });
export const AudioDecision = z.object({ asset_ids: z.array(z.string().uuid()).min(1).max(200), note: z.string().trim().max(500).optional() });

interface AssetRow {
  id: string; audio_id: string; script_hash: string; sha256: string | null; digital_status: string; technical_status: string; rights_status: string;
  cast_approved: boolean; invalidated_at: string | null; history: Array<Record<string, unknown>> | null; asr_roundtrip: { cer_phonetic?: number; wer?: number; engine?: string } | null; created_at: string;
}
const COLS = 'id, audio_id, script_hash, sha256, digital_status, technical_status, rights_status, cast_approved, invalidated_at, history, asr_roundtrip, created_at';

/** The owner's latest listening verdict on this exact file, if any. */
export function ownerListening(a: Pick<AssetRow, 'history'>): { decision: 'OK' | 'ISSUE'; at: string; note: string | null } | null {
  const ev = [...(a.history ?? [])].reverse().find((h) => h.event === 'owner_listened');
  return ev ? { decision: ev.decision as 'OK' | 'ISSUE', at: String(ev.at), note: (ev.note as string | null) ?? null } : null;
}

/** Why a file cannot be released yet (empty = eligible), in the owner's language. */
export function audioReleaseBlockers(a: AssetRow, jobScriptHash: string | null): string[] {
  const out: string[] = [];
  if (a.invalidated_at || a.script_hash !== jobScriptHash) out.push('файл устарел: сценарий изменён или есть новый рендер');
  if (a.technical_status !== 'TECHNICAL_PASS') out.push('технический QA не пройден');
  if (a.digital_status !== 'AUDIO_VERIFIED_DIGITAL') out.push('проверка распознаванием не пройдена');
  if (!a.cast_approved) out.push('кастинг ролей не утверждён');
  if (a.rights_status === 'DEV_LOCAL_ONLY') out.push('голос только для разработки (лицензия)');
  else if (a.rights_status !== 'PROVIDER_TERMS_RECORDED') out.push('условия провайдера голоса не записаны');
  const l = ownerListening(a);
  if (!l) out.push('владелец ещё не прослушал файл');
  else if (l.decision !== 'OK') out.push('при прослушивании отмечена проблема');
  return out;
}

export async function recordListening(actor: SessionUser, input: z.infer<typeof ListenReview>) {
  const db = adminClient();
  const { data: a } = await db.from('audio_assets').select('id, audio_id, history, invalidated_at').eq('id', input.asset_id).maybeSingle();
  if (!a || a.invalidated_at) throw new HttpError(404, 'NOT_FOUND', 'Файл не найден или устарел');
  if (input.decision === 'ISSUE' && !input.note) throw new HttpError(400, 'NOTE_REQUIRED', 'Опишите проблему: что слышно не так и где.');
  const history = [...((a.history as unknown[]) ?? []), { at: new Date().toISOString(), event: 'owner_listened', decision: input.decision, note: input.note ?? null, by: actor.userId }];
  await db.from('audio_assets').update({ history }).eq('id', a.id);
  await audit(actor.userId, 'audio.owner_listened', { id: a.id }, { audio_id: a.audio_id, decision: input.decision });
  return { asset_id: a.id, decision: input.decision };
}

export async function decideAudioRelease(actor: SessionUser, input: z.infer<typeof AudioDecision>) {
  const db = adminClient();
  const { data: policy } = await db.from('publication_policies').select('id').is('revoked_at', null).order('signed_at', { ascending: false }).limit(1).maybeSingle();
  if (!policy) throw new HttpError(409, 'NO_POLICY', 'Нет действующей подписанной цифровой политики выпуска.');
  const { data: assets } = await db.from('audio_assets').select(COLS).in('id', input.asset_ids);
  const rows = (assets ?? []) as AssetRow[];
  if (rows.length !== input.asset_ids.length) throw new HttpError(404, 'NOT_FOUND', 'Часть файлов не найдена.');
  const { data: jobs } = await db.from('audio_jobs').select('audio_id, script_hash').in('audio_id', [...new Set(rows.map((r) => r.audio_id))]);
  const scriptOf = new Map((jobs ?? []).map((j) => [j.audio_id, j.script_hash as string]));
  const blocked = rows.map((r) => ({ id: r.id, audio_id: r.audio_id, blockers: audioReleaseBlockers(r, scriptOf.get(r.audio_id) ?? null) })).filter((x) => x.blockers.length);
  if (blocked.length) throw new HttpError(409, 'NOT_ELIGIBLE', `Не готово к выпуску: ${blocked.map((b) => `${b.audio_id} — ${b.blockers.join('; ')}`).join(' | ')}`);
  // QA snapshot of exactly what is being released (bytes, verdicts, listening) → batch → decision → releases.
  const snapshot = rows.map((r) => ({ asset_id: r.id, audio_id: r.audio_id, sha256: r.sha256, digital_status: r.digital_status, rights_status: r.rights_status, cer_phonetic: r.asr_roundtrip?.cer_phonetic ?? null, asr: r.asr_roundtrip?.engine ?? null, listened: ownerListening(r) }));
  const reportSha = sha256Hex(stableStringify(snapshot));
  const now = new Date().toISOString();
  const { data: batch, error: be } = await db.from('qa_batches').insert({
    label: `Аудио · снимок цифрового QA (${rows.length})`, scope: { kind: 'audio', asset_ids: input.asset_ids }, tool_version: 'greekos-audio-qa/2', status: 'COMPLETED',
    counts: { assets: rows.length, PASS: rows.length }, report_sha256: reportSha, run_by: actor.userId, started_at: now, finished_at: now,
  }).select('id').single();
  if (be) throw new Error(be.message);
  const { data: decision, error: de } = await db.from('release_decisions').insert({
    batch_id: batch.id, policy_id: policy.id, scope: { kind: 'audio', asset_ids: input.asset_ids }, risk_acceptance: 'PASS_ONLY', sample_size: rows.length, sample_ok: rows.length,
    counts: { released: rows.length, snapshot }, note: input.note ?? null, decided_by: actor.userId,
  }).select('id').single();
  if (de) throw new Error(de.message);
  const { data: existing } = await db.from('content_releases').select('content_id, content_hash').eq('content_kind', 'audio_asset').is('revoked_at', null).in('content_id', input.asset_ids);
  const have = new Set((existing ?? []).map((e) => `${e.content_id}|${e.content_hash}`));
  const fresh = rows.filter((r) => !have.has(`${r.id}|${r.sha256}`)).map((r) => ({
    content_kind: 'audio_asset', content_id: r.id, content_hash: r.sha256, review_type: 'OWNER_DIGITAL_POLICY', reviewer_identity: `${actor.profile.display_name} (владелец, цифровая политика)`,
    reviewer_user_id: actor.userId, method: `Цифровой QA аудио (технический + распознавание по сегментам) и прослушивание владельцем; снимок ${reportSha.slice(0, 12)}`,
    scope: 'audio_playback', decision: 'APPROVED', reviewed_at: now, rights_scope: 'Синтезированная речь; условия провайдера голоса записаны', policy_id: policy.id, qa_batch_id: batch.id, decision_id: decision.id,
  }));
  if (fresh.length) {
    const { error } = await db.from('content_releases').insert(fresh);
    if (error) throw new Error(error.message);
  }
  await audit(actor.userId, 'audio.release_decision', { id: decision.id }, { batch_id: batch.id, released: fresh.length });
  return { decision_id: decision.id, batch_id: batch.id, released: fresh.length, already_released: rows.length - fresh.length };
}
