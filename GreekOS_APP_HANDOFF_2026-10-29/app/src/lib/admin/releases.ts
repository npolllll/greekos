import 'server-only';
import { z } from 'zod';
import { adminClient } from '../supabase/admin.ts';
import { audit, HttpError, type SessionUser } from '../auth.ts';
import { releaseActive, type ReleaseKind } from '../content/repo.ts';

export const ReleaseRequest = z.object({
  expand: z.enum(['unit', 'item', 'exam_component', 'pegp_packet', 'rg_expression', 'scenario', 'audio_asset', 'diagnostics']),
  id: z.string().min(1).max(80),
  review_type: z.enum(['OWNER_DIGITAL_POLICY', 'HUMAN_TEACHER_REVIEW', 'HUMAN_EXAMINER_REVIEW']),
  reviewer_identity: z.string().max(200).optional(),
  method: z.string().min(3).max(500),
  evidence_path: z.string().max(500).optional(),
  evidence_hash: z.string().max(128).optional(),
  rights_scope: z.string().min(3).max(300),
  expires_at: z.string().datetime({ offset: true }).optional(),
}).strict();
export type ReleaseRequest = z.infer<typeof ReleaseRequest>;

interface Target { kind: ReleaseKind; id: string; hash: string; scope: string; requiresAudio?: boolean; pegp?: boolean }

export async function activePolicy() {
  const { data } = await adminClient().from('publication_policies').select('id, kind, version, statement_ru, risks_acknowledged, signed_by, signed_at, revoked_at')
    .is('revoked_at', null).order('signed_at', { ascending: false }).limit(1).maybeSingle();
  return data;
}

function itemScope(module: string, pool: string | null): string {
  if (pool === 'diagnostic_holdout') return 'diagnostic';
  if (module === 'keg_b2') return 'exam_practice';
  if (module === 'pegp') return 'pegp_session';
  if (module === 'real_greek') return 'real_greek';
  return 'learner_practice';
}

type ItemFilter = { col: 'item_id' | 'unit_id' | 'pool'; eq?: string; in?: string[] };

async function itemTargets(f: ItemFilter): Promise<Target[]> {
  if (f.in && !f.in.length) return [];
  const out: Array<{ item_id: string; module: string; pool: string | null; current_hash: string; requires_audio: boolean }> = [];
  const values = f.in ?? [f.eq!];
  for (let i = 0; i < values.length; i += 100) {
    let q = adminClient().from('items').select('item_id, module, pool, current_hash, requires_audio');
    q = f.in ? q.in(f.col, values.slice(i, i + 100)) : q.eq(f.col, f.eq!);
    const { data, error } = await q.order('item_id').limit(1000);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!f.in) break;
  }
  return out.map((i) => ({ kind: 'item' as const, id: i.item_id, hash: i.current_hash, scope: itemScope(i.module, i.pool), requiresAudio: i.requires_audio, pegp: i.module === 'pegp' }));
}

/** Expand a release request into exact (kind, id, current hash) targets. */
export async function resolveTargets(expand: ReleaseRequest['expand'], id: string): Promise<Target[]> {
  const db = adminClient();
  switch (expand) {
    case 'item':
      return itemTargets({ col: 'item_id', eq: id });
    case 'unit': {
      const { data: u } = await db.from('units').select('unit_id, current_hash').eq('unit_id', id).maybeSingle();
      if (!u) throw new HttpError(404, 'NOT_FOUND', 'Урок не найден');
      const items = await itemTargets({ col: 'unit_id', eq: id });
      return [{ kind: 'unit', id: u.unit_id, hash: u.current_hash, scope: 'learner_practice' }, ...items];
    }
    case 'diagnostics':
      return itemTargets({ col: 'pool', eq: 'diagnostic_holdout' });
    case 'exam_component': {
      const { data: c } = await db.from('exam_components').select('component_id, item_ids').eq('component_id', id).maybeSingle();
      if (!c) throw new HttpError(404, 'NOT_FOUND', 'Компонент не найден');
      return itemTargets({ col: 'item_id', in: c.item_ids as string[] });
    }
    case 'pegp_packet': {
      const { data: p } = await db.from('pegp_packets').select('packet_id, current_hash, payload').eq('packet_id', id).maybeSingle();
      if (!p) throw new HttpError(404, 'NOT_FOUND', 'Пакет ΠΕΓΠ не найден');
      const pl = p.payload as { item_ids?: string[]; language_item_ids?: string[] };
      const ids = [...(pl.item_ids ?? []), ...(pl.language_item_ids ?? [])];
      const items = await itemTargets({ col: 'item_id', in: ids });
      return [{ kind: 'pegp_packet', id: p.packet_id, hash: p.current_hash, scope: 'pegp_session', pegp: true }, ...items];
    }
    case 'rg_expression': {
      const { data: r } = await db.from('rg_expressions').select('expression_id, current_hash, payload').eq('expression_id', id).maybeSingle();
      if (!r) throw new HttpError(404, 'NOT_FOUND', 'Выражение не найдено');
      const ids = ((r.payload as { learning_items?: Array<{ item_id: string }> }).learning_items ?? []).map((x) => x.item_id);
      const items = await itemTargets({ col: 'item_id', in: ids });
      return [{ kind: 'rg_expression', id: r.expression_id, hash: r.current_hash, scope: 'real_greek' }, ...items];
    }
    case 'scenario': {
      const { data: s } = await db.from('speaking_scenarios').select('scenario_id, current_hash').eq('scenario_id', id).maybeSingle();
      if (!s) throw new HttpError(404, 'NOT_FOUND', 'Сценарий не найден');
      return [{ kind: 'scenario', id: s.scenario_id, hash: s.current_hash, scope: 'learner_practice' }];
    }
    case 'audio_asset': {
      const { data: a } = await db.from('audio_assets').select('id, audio_id, script_hash, sha256, digital_status, rights_status, invalidated_at').eq('id', id).maybeSingle();
      if (!a || !a.sha256) throw new HttpError(404, 'NOT_FOUND', 'Аудио не найдено');
      const { data: job } = await db.from('audio_jobs').select('script_hash').eq('audio_id', a.audio_id).maybeSingle();
      if (a.invalidated_at || job?.script_hash !== a.script_hash) throw new HttpError(409, 'AUDIO_INVALIDATED', 'Аудио устарело: сценарий изменился.');
      if (a.digital_status !== 'AUDIO_VERIFIED_DIGITAL') throw new HttpError(409, 'AUDIO_NOT_VERIFIED', 'Аудио не прошло цифровую проверку (ASR round-trip и технический QA).');
      if (a.rights_status !== 'PROVIDER_TERMS_RECORDED') throw new HttpError(409, 'RIGHTS_PENDING', 'Сначала запишите условия провайдера (права на использование).');
      return [{ kind: 'audio_asset', id: a.id, hash: a.sha256, scope: 'audio_playback' }];
    }
  }
}

export interface ReleaseOutcome { created: number; skipped_existing: number; audio_pending: string[]; targets: number }

/** Creates one approved release per exact current hash. A client flag can never release anything. */
export async function createReleases(actor: SessionUser, req: ReleaseRequest): Promise<ReleaseOutcome> {
  const db = adminClient();
  const targets = await resolveTargets(req.expand, req.id);
  if (!targets.length) throw new HttpError(404, 'NOT_FOUND', 'Нечего выпускать');
  let policyId: string | null = null;
  let identity = req.reviewer_identity?.trim() ?? '';
  if (req.review_type === 'OWNER_DIGITAL_POLICY') {
    const policy = await activePolicy();
    if (!policy) throw new HttpError(409, 'NO_POLICY', 'Нет действующей цифровой политики выпуска. Подпишите её в разделе «Политика выпуска».');
    policyId = policy.id;
    identity = `${actor.profile.display_name} (владелец, цифровая политика)`;
  } else {
    if (!identity || !req.evidence_path?.trim() || !req.evidence_hash?.trim()) throw new HttpError(400, 'EVIDENCE_REQUIRED', 'Для внешней проверки нужны: имя проверяющего, путь к доказательству и его хеш.');
  }
  if (targets.some((t) => t.pegp) && !req.expires_at) throw new HttpError(400, 'EXPIRY_REQUIRED', 'Материалы ΠΕΓΠ выпускаются только с датой окончания (для конкретной сессии экзамена).');
  if (req.expires_at && new Date(req.expires_at) <= new Date()) throw new HttpError(400, 'EXPIRY_PAST', 'Дата окончания должна быть в будущем.');

  // Skip targets that already hold an active release for their current hash.
  const existing = new Set<string>();
  for (let i = 0; i < targets.length; i += 80) {
    const chunk = targets.slice(i, i + 80);
    const kinds = [...new Set(chunk.map((t) => t.kind))];
    const { data } = await db.from('content_releases').select('content_kind, content_id, content_hash, decision, revoked_at, expires_at')
      .in('content_kind', kinds).in('content_id', chunk.map((t) => t.id)).is('revoked_at', null);
    for (const r of data ?? []) {
      const t = chunk.find((x) => x.kind === r.content_kind && x.id === r.content_id);
      if (t && releaseActive(r, t.hash)) existing.add(`${t.kind}:${t.id}`);
    }
  }
  const now = new Date().toISOString();
  const rows = targets.filter((t) => !existing.has(`${t.kind}:${t.id}`)).map((t) => ({
    content_kind: t.kind, content_id: t.id, content_hash: t.hash, review_type: req.review_type, reviewer_identity: identity,
    reviewer_user_id: actor.userId, method: req.method.trim(), scope: t.scope,
    evidence_path: req.review_type === 'OWNER_DIGITAL_POLICY' ? (req.evidence_path?.trim() || null) : req.evidence_path!.trim(),
    evidence_hash: req.review_type === 'OWNER_DIGITAL_POLICY' ? (req.evidence_hash?.trim() || null) : req.evidence_hash!.trim(),
    decision: 'APPROVED', reviewed_at: now, rights_scope: req.rights_scope.trim(),
    expires_at: req.expires_at ?? null, policy_id: policyId,
  }));
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db.from('content_releases').insert(rows.slice(i, i + 200));
    if (error) throw new Error(`release insert failed: ${error.message}`);
  }
  await audit(actor.userId, 'content.release', { id: `${req.expand}:${req.id}` }, { review_type: req.review_type, created: rows.length, skipped: existing.size, policy_id: policyId, expires_at: req.expires_at ?? null });
  return { created: rows.length, skipped_existing: existing.size, audio_pending: targets.filter((t) => t.requiresAudio).map((t) => t.id), targets: targets.length };
}

export const RevokeRequest = z.object({
  expand: ReleaseRequest.shape.expand.optional(),
  id: z.string().min(1).max(80).optional(),
  release_id: z.string().uuid().optional(),
  reason: z.string().min(3).max(500),
}).strict();

export async function revokeReleases(actor: SessionUser, req: z.infer<typeof RevokeRequest>): Promise<number> {
  const db = adminClient();
  const now = new Date().toISOString();
  let ids: string[] = [];
  if (req.release_id) ids = [req.release_id];
  else if (req.expand && req.id) {
    const targets = await resolveTargets(req.expand, req.id).catch((e) => { if (req.expand === 'audio_asset') return [{ kind: 'audio_asset' as const, id: req.id!, hash: '', scope: '' }]; throw e; });
    for (let i = 0; i < targets.length; i += 80) {
      const chunk = targets.slice(i, i + 80);
      const { data } = await db.from('content_releases').select('id').in('content_kind', [...new Set(chunk.map((t) => t.kind))]).in('content_id', chunk.map((t) => t.id)).is('revoked_at', null);
      ids.push(...(data ?? []).map((r) => r.id));
    }
  } else throw new HttpError(400, 'INVALID_REQUEST', 'Не указано, что отзывать');
  for (let i = 0; i < ids.length; i += 100) {
    await db.from('content_releases').update({ revoked_at: now, revoked_reason: req.reason }).in('id', ids.slice(i, i + 100)).is('revoked_at', null);
  }
  await audit(actor.userId, 'content.revoke', { id: req.release_id ?? `${req.expand}:${req.id}` }, { count: ids.length, reason: req.reason });
  return ids.length;
}
