/**
 * The AI editor (14.11.2026): the owner delegated the routine editorial steps — checking the sample,
 * the batch release of PASS material, the choice of voices and the review of course audio — and
 * keeps the acts only a person can take: signing the digital policy (risk acceptance) and recording the
 * voice provider's terms. Every delegated act is stored as the AI editor's (system actor, no user id),
 * never as the owner's and never as a human or teacher review. Nothing here signs anything.
 */
import 'server-only';
import { adminClient, selectAll } from '../supabase/admin.ts';
import { audit } from '../audit.ts';
import { sha256Hex, stableStringify } from '../content/stable-json.ts';
import { scopeStatus } from './release.ts';
import { audioReleaseBlockers, ASSET_COLS, type AssetRow } from './audio-release.ts';

export const EDITOR_ACTOR = 'ai-editorial/1.0';
export const EDITOR_IDENTITY = 'AI-редактор GreekOS (не человек)';

/** What the owner's signature delegates, word for word as signed. */
export const DELEGATION_RU = 'Поручаю AI-редактору GreekOS (это не человек и не преподаватель) действовать от своего, а не от моего имени: проверять выборку материалов, выпускать пакетом только материалы с вердиктом PASS последнего полного цифрового QA и чистой AI-проверкой выборки, выбирать голоса и проверять аудиозаписи, а после того как я сам запишу условия провайдера голоса — выпускать аудио, прошедшее цифровую проверку. Каждое такое действие записывается как действие AI-редактора, его можно отменить в Админ → «Выпуск» и «Политика выпуска».';

export interface Delegation {
  editorial_release: true; audio_release: true; voice_selection: true;
  scope: 'PASS_ONLY'; pegp_expires_at: string; statement_ru: string; delegated_at: string;
}

/** ΠΕΓΠ material cites the 2026/11 question bank: released until the end of May 2027, then re-checked. */
export const PEGP_DEFAULT_EXPIRY = '2027-05-31T23:59:59Z';

export function delegationRecord(at = new Date()): Delegation {
  return { editorial_release: true, audio_release: true, voice_selection: true, scope: 'PASS_ONLY', pegp_expires_at: PEGP_DEFAULT_EXPIRY, statement_ru: DELEGATION_RU, delegated_at: at.toISOString() };
}

export async function activeDelegatedPolicy(): Promise<{ id: string; signed_at: string; delegation: Delegation } | null> {
  const { data } = await adminClient().from('publication_policies').select('id, signed_at, delegation').is('revoked_at', null).order('signed_at', { ascending: false }).limit(1).maybeSingle();
  const d = data?.delegation as Delegation | null | undefined;
  return data && d?.editorial_release ? { id: data.id, signed_at: data.signed_at, delegation: d } : null;
}

async function latestFullBatch() {
  const { data } = await adminClient().from('qa_batches').select('id, report_sha256, started_at').eq('scope->>kind', 'all').eq('status', 'COMPLETED').order('started_at', { ascending: false }).limit(1).maybeSingle();
  return data;
}

/** The sample the release procedure draws for the latest full QA batch (whole package). */
export async function currentSample() {
  const batch = await latestFullBatch();
  if (!batch) return null;
  const st = await scopeStatus(batch.id, { kind: 'all' });
  return { batch_id: batch.id, releasable: st.releasable, sample: st.sample.map((s) => ({ item_id: s.content_id, hash: s.current_hash, item_type: s.item_type, reviewed: s.review?.decision ?? null })) };
}

export interface AiSampleReview { item_id: string; hash: string; decision: 'OK' | 'ISSUE'; note: string }

/** Records the AI editor's verdicts on the sample (exact hash), as the AI editor's, not the owner's. */
export async function recordAiSampleReviews(batchId: string, reviews: AiSampleReview[]) {
  const db = adminClient();
  const cur = await currentSample();
  if (!cur || cur.batch_id !== batchId) throw new Error('the batch is not the latest full QA batch');
  const inSample = new Map(cur.sample.map((s) => [s.item_id, s.hash]));
  let written = 0;
  for (const r of reviews) {
    if (inSample.get(r.item_id) !== r.hash) continue; // not in the sample, or the task changed since it was read
    await db.from('qa_sample_reviews').delete().eq('batch_id', batchId).eq('content_kind', 'item').eq('content_id', r.item_id).eq('reviewer_kind', 'ai_editorial');
    const { error } = await db.from('qa_sample_reviews').insert({ batch_id: batchId, content_kind: 'item', content_id: r.item_id, content_hash: r.hash, reviewer_id: null, reviewer_kind: 'ai_editorial', system_actor: EDITOR_ACTOR, decision: r.decision, note: r.note.slice(0, 1000), reviewed_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    if (r.decision === 'ISSUE') await db.from('qa_issues').insert({ batch_id: batchId, content_kind: 'item', content_id: r.item_id, content_hash: r.hash, check_id: 'editorial.sample_review', severity: 'blocking', field: null, message_ru: `AI-редактор (не человек), выборка: ${r.note}`.slice(0, 1000), evidence: { reviewer: EDITOR_ACTOR } });
    written += 1;
  }
  await audit(null, 'qa.sample_review.editorial', { id: batchId }, { system_actor: EDITOR_ACTOR, written, sample: cur.sample.length });
  return { written, sample: cur.sample.length };
}

const scopeFor = (module: string | null) => module === 'keg_b2' ? 'exam_practice' : module === 'pegp' ? 'pegp_session' : module === 'real_greek' ? 'real_greek' : 'learner_practice';

/**
 * The batch release the owner delegated: only under an active policy that delegates it, only PASS
 * objects of the latest full QA batch whose current hash was checked, only with a complete and clean
 * AI-reviewed sample. Returns why it did not release instead of throwing.
 */
export async function editorialRelease(): Promise<{ status: 'released' | 'pending'; reason?: string; released?: number; already?: number; decision_id?: string }> {
  const db = adminClient();
  const policy = await activeDelegatedPolicy();
  if (!policy) return { status: 'pending', reason: 'нет действующей политики владельца с поручением AI-редактору' };
  const batch = await latestFullBatch();
  if (!batch) return { status: 'pending', reason: 'нет завершённого полного цифрового QA' };
  const st = await scopeStatus(batch.id, { kind: 'all' });
  const missing = st.sample.filter((s) => !s.review);
  if (missing.length) return { status: 'pending', reason: `выборка не проверена: ${missing.length} из ${st.sample.length}` };
  const issues = st.sample.filter((s) => s.review?.decision === 'ISSUE');
  if (issues.length) return { status: 'pending', reason: `в выборке замечания: ${issues.map((s) => s.content_id).join(', ')}` };
  const allowed = st.objects.filter((o) => o.state === 'PASS');
  if (!allowed.length) return { status: 'pending', reason: 'нет материалов с вердиктом PASS' };
  const existing = new Set<string>();
  const ids = allowed.map((o) => o.content_id);
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from('content_releases').select('content_kind, content_id, content_hash').is('revoked_at', null).eq('decision', 'APPROVED').in('content_id', ids.slice(i, i + 200));
    for (const r of data ?? []) existing.add(`${r.content_kind}|${r.content_id}|${r.content_hash}`);
  }
  const fresh = allowed.filter((o) => !existing.has(`${o.content_kind}|${o.content_id}|${o.current_hash}`));
  if (!fresh.length) return { status: 'released', released: 0, already: allowed.length };
  const excluded = st.objects.filter((o) => o.state !== 'PASS').reduce<Record<string, number>>((a, o) => ({ ...a, [o.state]: (a[o.state] ?? 0) + 1 }), {});
  const signed = policy.signed_at.slice(0, 10);
  const { data: decision, error: de } = await db.from('release_decisions').insert({
    batch_id: batch.id, policy_id: policy.id, scope: { kind: 'all' }, risk_acceptance: 'PASS_ONLY', sample_size: st.sample.length, sample_ok: st.sample.length,
    counts: { released: fresh.length, already: allowed.length - fresh.length, excluded }, decided_by: null, system_actor: EDITOR_ACTOR,
    note: `Выпуск AI-редактором (не человеком) по поручению в политике владельца от ${signed}; только PASS.`, expires_at: policy.delegation.pegp_expires_at,
  }).select('id').single();
  if (de) throw new Error(de.message);
  const now = new Date().toISOString();
  const rows = fresh.map((o) => ({
    content_kind: o.content_kind, content_id: o.content_id, content_hash: o.current_hash, review_type: 'OWNER_DIGITAL_POLICY',
    reviewer_identity: `${EDITOR_IDENTITY} по цифровой политике владельца от ${signed}`, reviewer_user_id: null,
    method: `Цифровой QA ${batch.id.slice(0, 8)} (отчёт ${batch.report_sha256?.slice(0, 12) ?? '—'}) + AI-проверка выборки ${st.sample.length}/${st.sample.length} (не человек); только PASS`,
    scope: o.content_kind === 'scenario' ? 'learner_practice' : scopeFor(o.module), decision: 'APPROVED', reviewed_at: now,
    rights_scope: 'Оригинальный материал проекта; цифровая проверка, без независимой экспертизы', expires_at: o.module === 'pegp' ? policy.delegation.pegp_expires_at : null,
    policy_id: policy.id, qa_batch_id: batch.id, decision_id: decision.id,
  }));
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db.from('content_releases').insert(rows.slice(i, i + 200));
    if (error) throw new Error(`release insert failed: ${error.message}`);
  }
  await audit(null, 'content.release_decision.editorial', { id: decision.id }, { system_actor: EDITOR_ACTOR, batch_id: batch.id, released: rows.length, excluded });
  return { status: 'released', released: rows.length, already: allowed.length - fresh.length, decision_id: decision.id };
}

// ---------------- voices and casting ----------------

export interface VoiceDecision { voice_id: string; approve: boolean; note: string }
export interface CastDecision { cast_role_id: string; voice_id: string | null; approve: boolean; note: string }

/**
 * The AI editor's voice choice (delegated by the owner in writing): approves or declines catalog
 * voices and cast roles, approves the proposed per-job casting that uses approved roles, and marks
 * course audio rendered with exactly that approved casting as cast-approved. Stored with
 * approval_source = ai_editorial_delegated; the owner's own approvals are never overwritten silently.
 */
export async function applyVoiceDecisions(voices: VoiceDecision[], cast: CastDecision[]) {
  const db = adminClient();
  const now = new Date().toISOString();
  // qa_status keeps its existing vocabulary: the objective test passed (selected) or the voice is rejected;
  // who decided and why is in approval_source / approval_note. Every write is checked.
  const must = (label: string, r: { error: { message: string } | null }) => { if (r.error) throw new Error(`${label}: ${r.error.message}`); };
  for (const v of voices) {
    must(`voice ${v.voice_id}`, await db.from('voice_catalog').update(v.approve
      ? { approval_source: 'ai_editorial_delegated', approval_note: v.note, approved_at: now, qa_status: 'TECH_QA_PASS' }
      : { approval_source: null, approval_note: v.note, qa_status: 'REJECTED' }).eq('voice_id', v.voice_id).eq('approved_by_owner', false));
  }
  for (const c of cast) {
    const patch: Record<string, unknown> = { approved: c.approve, approved_by: null, approved_at: c.approve ? now : null, status: c.approve ? 'approved' : 'assigned', approval_source: c.approve ? 'ai_editorial_delegated' : null, approval_note: c.note };
    if (c.voice_id) patch.voice_id = c.voice_id;
    must(`cast ${c.cast_role_id}`, await db.from('cast_roles').update(patch).eq('cast_role_id', c.cast_role_id));
  }
  const approvedRoles = new Set(cast.filter((c) => c.approve).map((c) => c.cast_role_id));
  const { data: jobs } = await db.from('audio_job_casting').select('audio_id, speaker_role, cast_role_id, approved');
  let jobRows = 0;
  for (const j of jobs ?? []) {
    if (!j.cast_role_id || !approvedRoles.has(j.cast_role_id) || j.approved) continue;
    must(`job ${j.audio_id}`, await db.from('audio_job_casting').update({ approved: true, approved_by: null, approved_at: now, approval_source: 'ai_editorial_delegated', updated_at: now }).eq('audio_id', j.audio_id).eq('speaker_role', j.speaker_role));
    jobRows += 1;
  }
  const marked = await refreshAssetCastApproval();
  await audit(null, 'voices.editorial_selection', {}, { system_actor: EDITOR_ACTOR, voices: voices.map((v) => [v.voice_id, v.approve]), cast: cast.map((c) => [c.cast_role_id, c.voice_id, c.approve]), job_rows: jobRows, assets_cast_approved: marked });
  return { job_rows: jobRows, assets_cast_approved: marked };
}

/** Course audio counts as cast-approved only if every role was rendered with the voice that is now approved for it. */
export async function refreshAssetCastApproval(): Promise<number> {
  const db = adminClient();
  const [{ data: roles }, { data: voices }, { data: jobs }, assets] = await Promise.all([
    db.from('cast_roles').select('cast_role_id, voice_id, approved'),
    db.from('voice_catalog').select('voice_id, approved_by_owner, approval_source'),
    db.from('audio_job_casting').select('audio_id, speaker_role, cast_role_id, approved'),
    selectAll<{ id: string; audio_id: string; voice_map: Record<string, string> | null; cast_snapshot: Record<string, string> | null; cast_approved: boolean; history: unknown[] | null }>((f, t) => db.from('audio_assets').select('id, audio_id, voice_map, cast_snapshot, cast_approved, history').is('invalidated_at', null).range(f, t)),
  ]);
  const role = new Map((roles ?? []).map((r) => [r.cast_role_id, r]));
  const voiceOk = new Set((voices ?? []).filter((v) => v.approved_by_owner || v.approval_source === 'ai_editorial_delegated').map((v) => v.voice_id));
  const job = new Map((jobs ?? []).map((j) => [`${j.audio_id}|${j.speaker_role}`, j]));
  let marked = 0;
  for (const a of assets) {
    if (a.cast_approved || !a.cast_snapshot || !a.voice_map) continue;
    const ok = Object.entries(a.cast_snapshot).every(([speaker, castRole]) => {
      const r = role.get(castRole);
      return !!r?.approved && job.get(`${a.audio_id}|${speaker}`)?.approved && r.voice_id === a.voice_map![speaker] && voiceOk.has(r.voice_id!);
    });
    if (!ok) continue;
    await db.from('audio_assets').update({ cast_approved: true, history: [...(a.history ?? []), { at: new Date().toISOString(), event: 'cast_approved_editorial', by: EDITOR_ACTOR }] }).eq('id', a.id);
    marked += 1;
  }
  return marked;
}

// ---------------- course audio ----------------

export interface ListeningVerdict { asset_id: string; decision: 'OK' | 'ISSUE'; note: string; metrics?: Record<string, unknown> }

/** The AI editor's objective review of a file (measurements, two recognisers) — never called «listened by a person». */
export async function recordEditorialListening(verdicts: ListeningVerdict[]) {
  const db = adminClient();
  let written = 0;
  for (const v of verdicts) {
    const { data: a } = await db.from('audio_assets').select('id, sha256, history, invalidated_at').eq('id', v.asset_id).maybeSingle();
    if (!a || a.invalidated_at) continue;
    // Idempotent: the same verdict with the same note on the same file bytes is recorded once. A corrected note
    // (15.11: notes now say what each recogniser heard) is appended; the earlier record stays in the history.
    const last = [...((a.history as Array<{ event?: string; sha256?: string; decision?: string; note?: string }>) ?? [])].reverse().find((h) => h.event === 'editorial_reviewed');
    if (last && last.sha256 === a.sha256 && last.decision === v.decision && last.note === v.note.slice(0, 500)) continue;
    const history = [...((a.history as unknown[]) ?? []), { at: new Date().toISOString(), event: 'editorial_reviewed', decision: v.decision, note: v.note.slice(0, 500), by: EDITOR_ACTOR, sha256: a.sha256, metrics: v.metrics ?? null }];
    await db.from('audio_assets').update({ history }).eq('id', a.id);
    written += 1;
  }
  await audit(null, 'audio.editorial_review', {}, { system_actor: EDITOR_ACTOR, written, issues: verdicts.filter((v) => v.decision === 'ISSUE').length });
  return { written };
}

/**
 * A file the provider's own recogniser flagged only for recogniser artefacts (a number written as digits,
 * «μια/μία», a second accent mark, words merged at a boundary) is confirmed digitally by the AI editor when
 * a second, independent recogniser (Whisper) reads the flagged segments as the script. Stored as the AI
 * editor's act with that evidence — never as listening by a person. A failed or missing technical QA, or a
 * file the second recogniser also disputes, is not confirmed.
 */
export interface DigitalConfirmation { asset_id: string; sha256: string; evidence: Array<{ segment: string; azure: string; whisper: string; reason: string }> }
export async function confirmDigitalEditorial(items: DigitalConfirmation[]) {
  const db = adminClient();
  let confirmed = 0;
  const skipped: Array<{ asset_id: string; reason: string }> = [];
  for (const c of items) {
    const { data: a } = await db.from('audio_assets').select('id, audio_id, sha256, technical_status, digital_status, history, invalidated_at').eq('id', c.asset_id).maybeSingle();
    if (!a || a.invalidated_at) { skipped.push({ asset_id: c.asset_id, reason: 'файл устарел' }); continue; }
    if (a.sha256 !== c.sha256) { skipped.push({ asset_id: c.asset_id, reason: 'другой файл (sha256)' }); continue; }
    if (a.technical_status !== 'TECHNICAL_PASS') { skipped.push({ asset_id: c.asset_id, reason: 'технический QA не пройден' }); continue; }
    if (a.digital_status !== 'NEEDS_REVIEW' || !c.evidence.length) { skipped.push({ asset_id: c.asset_id, reason: `статус ${a.digital_status}` }); continue; }
    const now = new Date().toISOString();
    const history = [...((a.history as unknown[]) ?? []), { at: now, event: 'digital_confirmed_editorial', by: EDITOR_ACTOR, from: a.digital_status, sha256: a.sha256, evidence: c.evidence.slice(0, 12) }];
    await db.from('audio_assets').update({ digital_status: 'AUDIO_VERIFIED_DIGITAL', render_status: 'DIGITAL_REVIEWED', history }).eq('id', a.id).eq('sha256', c.sha256);
    await db.from('digital_qa_runs').insert({ content_kind: 'audio_asset', content_id: a.id, content_hash: a.sha256, check_kind: 'DIGITAL_AUDIO_QA', tool_id: `editorial:${EDITOR_ACTOR}+whisper-small`, verdict: 'PASS', report: { confirmed_by_second_recogniser: c.evidence, note: 'Подтверждено вторым независимым распознавателем; не прослушивание человеком' }, run_by: null });
    confirmed += 1;
  }
  await audit(null, 'audio.digital_confirmed_editorial', {}, { system_actor: EDITOR_ACTOR, confirmed, skipped: skipped.length });
  return { confirmed, skipped };
}

/** Releases every course audio file that has no blocker (provider terms recorded by the owner, digital QA, cast, review). */
export async function editorialAudioRelease(): Promise<{ status: 'released' | 'pending'; reason?: string; released?: number; blocked?: Record<string, number> }> {
  const db = adminClient();
  const policy = await activeDelegatedPolicy();
  if (!policy?.delegation.audio_release) return { status: 'pending', reason: 'нет действующей политики владельца с поручением AI-редактору' };
  const rows = await selectAll<AssetRow>((f, t) => db.from('audio_assets').select(ASSET_COLS).is('invalidated_at', null).range(f, t));
  const { data: jobs } = await db.from('audio_jobs').select('audio_id, script_hash');
  const scriptOf = new Map((jobs ?? []).map((j) => [j.audio_id, j.script_hash as string]));
  const blocked: Record<string, number> = {};
  const eligible = rows.filter((r) => {
    const b = audioReleaseBlockers(r, scriptOf.get(r.audio_id) ?? null, { acceptEditorial: true });
    for (const x of b) blocked[x] = (blocked[x] ?? 0) + 1;
    return !b.length && r.sha256;
  });
  const { data: existing } = await db.from('content_releases').select('content_id, content_hash').eq('content_kind', 'audio_asset').is('revoked_at', null);
  const have = new Set((existing ?? []).map((e) => `${e.content_id}|${e.content_hash}`));
  const fresh = eligible.filter((r) => !have.has(`${r.id}|${r.sha256}`));
  if (!fresh.length) return { status: eligible.length ? 'released' : 'pending', released: 0, blocked, reason: eligible.length ? undefined : 'нет файлов без препятствий' };
  const snapshot = fresh.map((r) => ({ asset_id: r.id, audio_id: r.audio_id, sha256: r.sha256, digital_status: r.digital_status, rights_status: r.rights_status }));
  const reportSha = sha256Hex(stableStringify(snapshot));
  const now = new Date().toISOString();
  const { data: batch, error: be } = await db.from('qa_batches').insert({
    label: `Аудио · снимок цифрового QA и AI-проверки (${fresh.length})`, scope: { kind: 'audio', asset_ids: fresh.map((r) => r.id) }, tool_version: 'greekos-audio-qa/2+editorial', status: 'COMPLETED',
    counts: { assets: fresh.length, PASS: fresh.length }, report_sha256: reportSha, run_by: null, started_at: now, finished_at: now,
  }).select('id').single();
  if (be) throw new Error(be.message);
  const { data: decision, error: de } = await db.from('release_decisions').insert({
    batch_id: batch.id, policy_id: policy.id, scope: { kind: 'audio', count: fresh.length }, risk_acceptance: 'PASS_ONLY', sample_size: fresh.length, sample_ok: fresh.length,
    counts: { released: fresh.length, blocked }, decided_by: null, system_actor: EDITOR_ACTOR, note: `Выпуск аудио AI-редактором (не человеком) по поручению в политике владельца от ${policy.signed_at.slice(0, 10)}.`,
  }).select('id').single();
  if (de) throw new Error(de.message);
  const out = fresh.map((r) => ({
    content_kind: 'audio_asset', content_id: r.id, content_hash: r.sha256, review_type: 'OWNER_DIGITAL_POLICY', reviewer_identity: `${EDITOR_IDENTITY} по цифровой политике владельца`,
    reviewer_user_id: null, method: `Цифровой QA аудио (технический + распознавание по сегментам) и объективная AI-проверка файла (не прослушивание человеком); снимок ${reportSha.slice(0, 12)}`,
    scope: 'audio_playback', decision: 'APPROVED', reviewed_at: now, rights_scope: 'Синтезированная речь; условия провайдера голоса записаны владельцем', policy_id: policy.id, qa_batch_id: batch.id, decision_id: decision.id,
  }));
  for (let i = 0; i < out.length; i += 200) {
    const { error } = await db.from('content_releases').insert(out.slice(i, i + 200));
    if (error) throw new Error(error.message);
  }
  await audit(null, 'audio.release_decision.editorial', { id: decision.id }, { system_actor: EDITOR_ACTOR, released: out.length, blocked });
  return { status: 'released', released: out.length, blocked };
}
