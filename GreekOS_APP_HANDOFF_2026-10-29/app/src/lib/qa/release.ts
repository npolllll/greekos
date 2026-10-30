/**
 * Owner release procedure on top of digital QA (v6):
 *   per-issue resolution (false positive / accepted risk with reason / fix by a new revision)
 *   → deterministic sample review by the owner → batch decision under the signed digital policy
 *   → releases bound to exact hashes, citing the QA batch and the decision → journal / revoke.
 * A signed policy alone never releases anything; HUMAN_* review types are never written here.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { adminClient, selectAll } from '../supabase/admin.ts';
import { audit } from '../audit.ts';
import { HttpError, type SessionUser } from '../session-user.ts';
import { contentHash, sha256Hex, stableStringify } from '../content/stable-json.ts';
import type { ItemEnvelope } from '../content/types.ts';
import { runQaBatch } from './run.ts';

// Issues that only the content itself can fix: they cannot be "accepted" as a risk.
const NOT_ACCEPTABLE = new Set(['ortho.final_sigma', 'ortho.mixed_script', 'hash.envelope', 'hash.revision', 'schema.adapter', 'keys.present', 'keys.choice_resolves', 'keys.options_duplicate', 'refs.unit', 'refs.competencies', 'refs.audio_jobs', 'refs.rubric', 'refs.text_object']);

export const IssueAction = z.object({
  issue_id: z.string().uuid(),
  action: z.enum(['false_positive', 'accepted_risk', 'reopen']),
  note: z.string().max(1000).default(''),
}).strict();

export async function resolveIssue(actor: SessionUser, input: z.infer<typeof IssueAction>) {
  const db = adminClient();
  const { data: issue } = await db.from('qa_issues').select('id, check_id, severity, status, content_id').eq('id', input.issue_id).maybeSingle();
  if (!issue) throw new HttpError(404, 'NOT_FOUND', 'Замечание не найдено');
  if (issue.status === 'superseded') throw new HttpError(409, 'SUPERSEDED', 'Замечание относится к устаревшему прогону — откройте последний пакет.');
  if (input.action === 'accepted_risk') {
    if (NOT_ACCEPTABLE.has(issue.check_id)) throw new HttpError(422, 'MUST_FIX', 'Эту ошибку нельзя принять как риск — её нужно исправить в материале.');
    if (input.note.trim().length < (issue.check_id === 'rights.license' ? 20 : 5)) throw new HttpError(422, 'NOTE_REQUIRED', issue.check_id === 'rights.license' ? 'Опишите происхождение материала и основание прав (не меньше 20 символов).' : 'Коротко объясните, почему риск приемлем.');
  }
  if (input.action === 'false_positive' && input.note.trim().length < 3) throw new HttpError(422, 'NOTE_REQUIRED', 'Укажите, почему это ложное срабатывание.');
  const reopen = input.action === 'reopen';
  await db.from('qa_issues').update({ status: reopen ? 'open' : input.action, resolved_by: reopen ? null : actor.userId, resolved_at: reopen ? null : new Date().toISOString(), resolution_note: reopen ? null : input.note.trim() }).eq('id', issue.id);
  await audit(actor.userId, `qa.issue.${input.action}`, { id: issue.id }, { check_id: issue.check_id, content_id: issue.content_id });
  return { ok: true };
}

// ---------------- Editorial corrections (new revision) ----------------

export const ItemPatch = z.object({
  item_id: z.string().min(1).max(80),
  base_hash: z.string().regex(/^[0-9a-f]{64}$/),
  reason: z.string().min(3).max(1000),
  issue_id: z.string().uuid().optional(),
  changes: z.object({
    prompt: z.string().min(1).max(4000).optional(),
    options: z.array(z.string().min(1).max(500)).max(12).optional(),
    answer: z.array(z.string().min(1).max(500)).max(12).optional(),
    accepted_alternatives: z.array(z.string().min(1).max(500)).max(40).optional(),
    model_response: z.string().max(6000).nullable().optional(),
  }).strict(),
}).strict();

/** Applies an owner correction as a NEW immutable revision; active releases of the old hash are revoked. */
export async function patchItem(actor: SessionUser, input: z.infer<typeof ItemPatch>) {
  const db = adminClient();
  const { data: row } = await db.from('items').select('item_id, module, envelope, current_hash').eq('item_id', input.item_id).maybeSingle();
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Задание не найдено');
  if (row.current_hash !== input.base_hash) throw new HttpError(409, 'STALE', 'Задание уже изменилось — обновите страницу.');
  const env = row.envelope as ItemEnvelope;
  if (input.changes.options && Array.isArray(env.options) && input.changes.options.length !== env.options.length) throw new HttpError(422, 'OPTIONS_SHAPE', 'Число вариантов должно сохраниться (иначе меняется структура задания).');
  const next: ItemEnvelope = {
    ...env,
    ...(input.changes.prompt !== undefined ? { prompt: input.changes.prompt } : {}),
    ...(input.changes.options !== undefined ? { options: input.changes.options } : {}),
    ...(input.changes.answer !== undefined ? { answer: input.changes.answer } : {}),
    ...(input.changes.accepted_alternatives !== undefined ? { accepted_alternatives: input.changes.accepted_alternatives } : {}),
    ...(input.changes.model_response !== undefined ? { model_response: input.changes.model_response } : {}),
  };
  const hash = contentHash(next);
  if (hash === row.current_hash) throw new HttpError(422, 'NO_CHANGE', 'Изменений нет.');
  const { data: rev, error: re } = await db.from('content_revisions').insert({ content_kind: 'item', content_id: row.item_id, content_hash: hash, module: row.module, payload_private: next }).select('id').single();
  if (re) throw new Error(re.message);
  const { error: ue } = await db.from('items').update({ envelope: next, current_hash: hash, revision_id: rev.id }).eq('item_id', row.item_id).eq('current_hash', row.current_hash);
  if (ue) throw new Error(ue.message);
  const changed = Object.fromEntries(Object.entries(input.changes).map(([k, v]) => [k, { before: (env as unknown as Record<string, unknown>)[k] ?? null, after: v }]));
  await db.from('content_patches').insert({ content_kind: 'item', content_id: row.item_id, base_hash: row.current_hash, new_hash: hash, changes: changed, reason: input.reason, issue_id: input.issue_id ?? null, revision_id: rev.id, created_by: actor.userId });
  const { count } = await db.from('content_releases').update({ revoked_at: new Date().toISOString(), revoked_reason: 'CONTENT_PATCHED: допуск относился к прежней ревизии' }, { count: 'exact' }).eq('content_kind', 'item').eq('content_id', row.item_id).is('revoked_at', null);
  if (input.issue_id) await db.from('qa_issues').update({ status: 'fixed', resolved_by: actor.userId, resolved_at: new Date().toISOString(), resolution_note: `Исправлено ревизией ${hash.slice(0, 12)}: ${input.reason}` }).eq('id', input.issue_id);
  await audit(actor.userId, 'content.patch', { id: row.item_id }, { base_hash: row.current_hash, new_hash: hash, revoked_releases: count ?? 0 });
  const qa = await runQaBatch({ actorId: actor.userId, label: `Повторная проверка после правки ${row.item_id}`, scope: { kind: 'items', ids: [row.item_id] } });
  return { ok: true, new_hash: hash, revoked_releases: count ?? 0, qa };
}

export const UnitPatch = z.object({
  unit_id: z.string().min(1).max(40),
  base_hash: z.string().min(16).max(64),
  field: z.enum(['theory_ru', 'learning_outcome']),
  text: z.string().min(1).max(20000),
  reason: z.string().min(3).max(1000),
  issue_id: z.string().uuid().optional(),
}).strict();

export async function patchUnit(actor: SessionUser, input: z.infer<typeof UnitPatch>) {
  const db = adminClient();
  const { data: u } = await db.from('units').select('unit_id, teaching, current_hash').eq('unit_id', input.unit_id).maybeSingle();
  if (!u) throw new HttpError(404, 'NOT_FOUND', 'Урок не найден');
  if (u.current_hash !== input.base_hash) throw new HttpError(409, 'STALE', 'Урок уже изменился — обновите страницу.');
  const teaching = { ...(u.teaching as Record<string, unknown>), [input.field]: input.text };
  const hash = sha256Hex(stableStringify(teaching));
  const { data: rev, error: re } = await db.from('content_revisions').insert({ content_kind: 'unit', content_id: u.unit_id, content_hash: hash, module: 'core', payload_private: { unit_id: u.unit_id, content_hash: hash, teaching_material: teaching, patched_from: u.current_hash } }).select('id').single();
  if (re) throw new Error(re.message);
  await db.from('units').update({ teaching, current_hash: hash, revision_id: rev.id }).eq('unit_id', u.unit_id).eq('current_hash', u.current_hash);
  await db.from('content_patches').insert({ content_kind: 'unit', content_id: u.unit_id, base_hash: u.current_hash, new_hash: hash, changes: { [input.field]: { before: (u.teaching as Record<string, unknown>)[input.field] ?? null, after: input.text } }, reason: input.reason, issue_id: input.issue_id ?? null, revision_id: rev.id, created_by: actor.userId });
  const { count } = await db.from('content_releases').update({ revoked_at: new Date().toISOString(), revoked_reason: 'CONTENT_PATCHED: допуск относился к прежней ревизии' }, { count: 'exact' }).eq('content_kind', 'unit').eq('content_id', u.unit_id).is('revoked_at', null);
  if (input.issue_id) await db.from('qa_issues').update({ status: 'fixed', resolved_by: actor.userId, resolved_at: new Date().toISOString(), resolution_note: `Исправлено ревизией ${hash.slice(0, 12)}: ${input.reason}` }).eq('id', input.issue_id);
  await audit(actor.userId, 'content.patch', { id: u.unit_id }, { base_hash: u.current_hash, new_hash: hash, revoked_releases: count ?? 0 });
  const qa = await runQaBatch({ actorId: actor.userId, label: `Повторная проверка после правки ${u.unit_id}`, scope: { kind: 'unit', ids: [u.unit_id] } });
  return { ok: true, new_hash: hash, revoked_releases: count ?? 0, qa };
}

// ---------------- Scope, sample and decision ----------------

export const DecisionScope = z.object({
  kind: z.enum(['unit', 'level', 'module', 'items']),
  ids: z.array(z.string().min(1).max(80)).max(500).optional(),
  module: z.enum(['core', 'keg_b2', 'pegp', 'real_greek']).optional(),
  level: z.enum(['A1', 'A2', 'B1', 'B2']).optional(),
}).strict();
type Scope = z.infer<typeof DecisionScope>;

export interface ScopeObject { content_kind: 'item' | 'unit' | 'scenario'; content_id: string; current_hash: string; module: string | null; unit_id: string | null }

export async function scopeObjects(scope: Scope): Promise<ScopeObject[]> {
  const db = adminClient();
  const items = await selectAll<{ item_id: string; module: string; unit_id: string | null; level: string | null; current_hash: string }>((f, t) => db.from('items').select('item_id, module, unit_id, level, current_hash').order('item_id').range(f, t));
  const { data: units } = await db.from('units').select('unit_id, level, current_hash');
  const pick = items.filter((i) =>
    scope.kind === 'unit' ? scope.ids?.includes(i.unit_id ?? '') :
    scope.kind === 'level' ? i.module === 'core' && i.level === scope.level :
    scope.kind === 'module' ? i.module === scope.module :
    scope.ids?.includes(i.item_id));
  const unitIds = scope.kind === 'unit' ? scope.ids ?? [] : scope.kind === 'level' ? (units ?? []).filter((u) => u.level === scope.level).map((u) => u.unit_id) : [];
  return [
    ...(units ?? []).filter((u) => unitIds.includes(u.unit_id)).map((u) => ({ content_kind: 'unit' as const, content_id: u.unit_id, current_hash: u.current_hash, module: 'core', unit_id: u.unit_id })),
    ...pick.map((i) => ({ content_kind: 'item' as const, content_id: i.item_id, current_hash: i.current_hash, module: i.module, unit_id: i.unit_id })),
  ];
}

/** Deterministic sample of PASS/accepted items in a scope (sha256(batch|id) order). */
export function sampleSize(n: number): number {
  return Math.min(n, Math.max(5, Math.ceil(n * 0.1)));
}

export async function scopeStatus(batchId: string, scope: Scope) {
  const db = adminClient();
  const objs = await scopeObjects(scope);
  const ids = objs.map((o) => o.content_id);
  const results: Array<{ content_kind: string; content_id: string; content_hash: string; verdict: string }> = [];
  const issues: Array<{ id: string; content_id: string; check_id: string; severity: string; status: string; message_ru: string; field: string | null }> = [];
  for (let i = 0; i < ids.length; i += 200) {
    const [{ data: r }, { data: is }] = await Promise.all([
      db.from('qa_item_results').select('content_kind, content_id, content_hash, verdict').eq('batch_id', batchId).in('content_id', ids.slice(i, i + 200)),
      db.from('qa_issues').select('id, content_id, check_id, severity, status, message_ru, field').eq('batch_id', batchId).in('content_id', ids.slice(i, i + 200)).in('severity', ['blocking', 'warning']),
    ]);
    results.push(...(r ?? []));
    issues.push(...(is ?? []));
  }
  // Later per-object re-checks (after a patch) live in newer batches: use the newest result per hash.
  const { data: newer } = await db.from('qa_item_results').select('batch_id, content_id, content_hash, verdict, qa_batches!inner(started_at, status)').in('content_id', ids.length ? ids.slice(0, 500) : ['-']).eq('qa_batches.status', 'COMPLETED');
  const byId = new Map(results.map((r) => [r.content_id, r]));
  const evaluated = objs.map((o) => {
    const res = byId.get(o.content_id);
    const fresh = res && res.content_hash === o.current_hash;
    const own = issues.filter((x) => x.content_id === o.content_id);
    const openBlocking = own.filter((x) => x.severity === 'blocking' && x.status === 'open').length;
    const openWarnings = own.filter((x) => x.severity === 'warning' && x.status === 'open').length;
    const acceptedWarnings = own.filter((x) => x.status === 'accepted_risk').length;
    let state: 'PASS' | 'ACCEPTED' | 'NEEDS_DECISION' | 'BLOCKED' | 'STALE' | 'NOT_CHECKED' = 'NOT_CHECKED';
    if (!res) state = (newer ?? []).some((n) => n.content_id === o.content_id && n.content_hash === o.current_hash) ? 'STALE' : 'NOT_CHECKED';
    else if (!fresh) state = 'STALE';
    else if (openBlocking) state = 'BLOCKED';
    else if (openWarnings) state = 'NEEDS_DECISION';
    else if (res.verdict === 'PASS' && !acceptedWarnings) state = 'PASS';
    else state = 'ACCEPTED';
    return { ...o, verdict: res?.verdict ?? null, state, open_blocking: openBlocking, open_warnings: openWarnings };
  });
  const releasable = evaluated.filter((x) => x.state === 'PASS' || x.state === 'ACCEPTED');
  const items = releasable.filter((x) => x.content_kind === 'item');
  const order = (id: string) => createHash('sha256').update(`${batchId}|${id}`).digest('hex');
  const sample = [...items].sort((a, b) => order(a.content_id).localeCompare(order(b.content_id))).slice(0, sampleSize(items.length));
  const { data: reviews } = await db.from('qa_sample_reviews').select('content_id, content_hash, decision, note, reviewed_at').eq('batch_id', batchId).in('content_id', sample.length ? sample.map((s) => s.content_id) : ['-']);
  return { objects: evaluated, releasable: releasable.length, sample: sample.map((s) => ({ ...s, review: (reviews ?? []).find((r) => r.content_id === s.content_id && r.content_hash === s.current_hash) ?? null })) };
}

export const SampleReview = z.object({ batch_id: z.string().uuid(), item_id: z.string().min(1).max(80), decision: z.enum(['OK', 'ISSUE']), note: z.string().max(1000).optional() }).strict();

export async function recordSample(actor: SessionUser, input: z.infer<typeof SampleReview>) {
  const db = adminClient();
  const { data: item } = await db.from('items').select('item_id, current_hash').eq('item_id', input.item_id).maybeSingle();
  if (!item) throw new HttpError(404, 'NOT_FOUND', 'Задание не найдено');
  if (input.decision === 'ISSUE' && !(input.note ?? '').trim()) throw new HttpError(422, 'NOTE_REQUIRED', 'Опишите найденную проблему.');
  const { error } = await db.from('qa_sample_reviews').upsert({ batch_id: input.batch_id, content_kind: 'item', content_id: item.item_id, content_hash: item.current_hash, reviewer_id: actor.userId, decision: input.decision, note: input.note ?? null, reviewed_at: new Date().toISOString() }, { onConflict: 'batch_id,content_kind,content_id,reviewer_id' });
  if (error) throw new Error(error.message);
  if (input.decision === 'ISSUE') {
    await db.from('qa_issues').insert({ batch_id: input.batch_id, content_kind: 'item', content_id: item.item_id, content_hash: item.current_hash, check_id: 'owner.sample_review', severity: 'blocking', field: null, message_ru: `Выборочная проверка владельцем: ${input.note}`, evidence: { reviewer: 'owner' } });
  }
  await audit(actor.userId, 'qa.sample_review', { id: item.item_id }, { decision: input.decision, batch_id: input.batch_id });
  return { ok: true };
}

export const Decision = z.object({
  batch_id: z.string().uuid(),
  scope: DecisionScope,
  risk_acceptance: z.enum(['PASS_ONLY', 'PASS_AND_ACCEPTED_WARNINGS']),
  note: z.string().max(2000).optional(),
  expires_at: z.string().datetime({ offset: true }).optional(),
  confirm: z.literal(true),
}).strict();

function scopeFor(module: string | null): string {
  return module === 'keg_b2' ? 'exam_practice' : module === 'pegp' ? 'pegp_session' : module === 'real_greek' ? 'real_greek' : 'learner_practice';
}

/**
 * The owner's batch decision. Requires: an active signed digital policy, a completed QA batch,
 * a complete and clean sample review for the scope, and only PASS (or explicitly accepted)
 * objects whose current hash is the checked hash. Everything else is listed as excluded.
 */
export async function decideRelease(actor: SessionUser, input: z.infer<typeof Decision>) {
  const db = adminClient();
  const { data: policy } = await db.from('publication_policies').select('id').is('revoked_at', null).order('signed_at', { ascending: false }).limit(1).maybeSingle();
  if (!policy) throw new HttpError(409, 'NO_POLICY', 'Нет действующей подписанной цифровой политики выпуска.');
  const { data: batch } = await db.from('qa_batches').select('id, status, report_sha256').eq('id', input.batch_id).maybeSingle();
  if (!batch || batch.status !== 'COMPLETED') throw new HttpError(409, 'NO_BATCH', 'Пакет QA не найден или не завершён.');
  const st = await scopeStatus(input.batch_id, input.scope);
  const sampleMissing = st.sample.filter((s) => !s.review);
  if (sampleMissing.length) throw new HttpError(409, 'SAMPLE_INCOMPLETE', `Выборочная проверка не завершена: осталось ${sampleMissing.length} из ${st.sample.length}.`);
  const sampleIssues = st.sample.filter((s) => s.review?.decision === 'ISSUE');
  if (sampleIssues.length) throw new HttpError(409, 'SAMPLE_ISSUES', `В выборке найдены проблемы (${sampleIssues.length}) — исправьте их и перепроверьте.`);
  const allowed = st.objects.filter((o) => o.state === 'PASS' || (input.risk_acceptance === 'PASS_AND_ACCEPTED_WARNINGS' && o.state === 'ACCEPTED'));
  const pegp = allowed.some((o) => o.module === 'pegp');
  if (pegp && !input.expires_at) throw new HttpError(400, 'EXPIRY_REQUIRED', 'Материалы ΠΕΓΠ выпускаются только с датой окончания.');
  if (!allowed.length) throw new HttpError(409, 'NOTHING_RELEASABLE', 'В выбранной области нет материалов, готовых к выпуску.');
  const excluded = st.objects.filter((o) => !allowed.includes(o)).reduce<Record<string, number>>((a, o) => ({ ...a, [o.state]: (a[o.state] ?? 0) + 1 }), {});
  const { data: decision, error: de } = await db.from('release_decisions').insert({
    batch_id: batch.id, policy_id: policy.id, scope: input.scope, risk_acceptance: input.risk_acceptance, sample_size: st.sample.length, sample_ok: st.sample.length,
    counts: { released: allowed.length, excluded }, note: input.note ?? null, decided_by: actor.userId, expires_at: input.expires_at ?? null,
  }).select('id').single();
  if (de) throw new Error(de.message);
  const now = new Date().toISOString();
  const rows = allowed.map((o) => ({
    content_kind: o.content_kind, content_id: o.content_id, content_hash: o.current_hash, review_type: 'OWNER_DIGITAL_POLICY',
    reviewer_identity: `${actor.profile.display_name} (владелец, цифровая политика)`, reviewer_user_id: actor.userId,
    method: `Цифровой QA ${batch.id.slice(0, 8)} (отчёт ${batch.report_sha256?.slice(0, 12) ?? '—'}) + выборочная проверка владельцем ${st.sample.length}/${st.sample.length}; ${input.risk_acceptance === 'PASS_ONLY' ? 'только PASS' : 'PASS и принятые риски'}`,
    scope: o.content_kind === 'scenario' ? 'learner_practice' : scopeFor(o.module), decision: 'APPROVED', reviewed_at: now,
    rights_scope: 'Оригинальный материал проекта; цифровая проверка, без независимой экспертизы', expires_at: o.module === 'pegp' ? input.expires_at : null,
    policy_id: policy.id, qa_batch_id: batch.id, decision_id: decision.id,
  }));
  // Skip objects that already hold an active release for the same hash.
  const { data: existing } = await db.from('content_releases').select('content_kind, content_id, content_hash').is('revoked_at', null).in('content_id', rows.map((r) => r.content_id).slice(0, 1000));
  const have = new Set((existing ?? []).map((e) => `${e.content_kind}|${e.content_id}|${e.content_hash}`));
  const fresh = rows.filter((r) => !have.has(`${r.content_kind}|${r.content_id}|${r.content_hash}`));
  for (let i = 0; i < fresh.length; i += 200) {
    const { error } = await db.from('content_releases').insert(fresh.slice(i, i + 200));
    if (error) throw new Error(error.message);
  }
  await audit(actor.userId, 'content.release_decision', { id: decision.id }, { batch_id: batch.id, scope: input.scope, released: fresh.length, excluded });
  return { decision_id: decision.id, released: fresh.length, already_released: rows.length - fresh.length, excluded };
}

export async function revokeDecision(actor: SessionUser, decisionId: string, reason: string) {
  const db = adminClient();
  const now = new Date().toISOString();
  const { count } = await db.from('content_releases').update({ revoked_at: now, revoked_reason: reason }, { count: 'exact' }).eq('decision_id', decisionId).is('revoked_at', null);
  await db.from('release_decisions').update({ revoked_at: now, revoked_by: actor.userId, revoked_reason: reason }).eq('id', decisionId);
  await audit(actor.userId, 'content.release_decision.revoke', { id: decisionId }, { revoked: count ?? 0, reason });
  return { revoked: count ?? 0 };
}
