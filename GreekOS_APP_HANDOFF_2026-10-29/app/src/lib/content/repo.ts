import { env } from '../env.ts';
import { adminClient } from '../supabase/admin.ts';
import type { ItemEnvelope } from './types.ts';

export type ReleaseKind = 'item' | 'unit' | 'scenario' | 'audio_asset' | 'exam_component' | 'rg_expression' | 'pegp_packet' | 'context_example';

export interface ReleaseRow {
  id: string;
  content_kind: ReleaseKind;
  content_id: string;
  content_hash: string;
  review_type: string;
  scope: string;
  decision: string;
  revoked_at: string | null;
  expires_at: string | null;
  reviewed_at: string;
}

export interface ItemRow {
  item_id: string;
  module: string;
  unit_id: string | null;
  item_type: string;
  level: string | null;
  pool: string | null;
  section: string | null;
  requires_audio: boolean;
  scoring_strategy: string;
  competency_ids: string[];
  prerequisite_ids: string[];
  audio_job_ids: string[];
  error_tags: string[] | null;
  envelope: ItemEnvelope;
  current_hash: string;
}

/** A release counts only for the exact current hash, approved, not revoked and not expired. */
export function releaseActive(r: Pick<ReleaseRow, 'content_hash' | 'decision' | 'revoked_at' | 'expires_at'>, currentHash: string, now = new Date()): boolean {
  return r.content_hash === currentHash && r.decision === 'APPROVED' && !r.revoked_at && (!r.expires_at || new Date(r.expires_at) > now);
}

const RELEASE_COLUMNS = 'id, content_kind, content_id, content_hash, review_type, scope, decision, revoked_at, expires_at, reviewed_at';

export async function activeReleases(kind: ReleaseKind, ids: string[]): Promise<ReleaseRow[]> {
  if (!ids.length) return [];
  const db = adminClient();
  if (ids.length <= 80) {
    const { data, error } = await db.from('content_releases').select(RELEASE_COLUMNS).eq('content_kind', kind).in('content_id', ids).is('revoked_at', null).eq('decision', 'APPROVED');
    if (error) throw error;
    return (data ?? []) as ReleaseRow[];
  }
  // Large lookups: page through all active releases of this kind (avoids oversized URLs).
  const wanted = new Set(ids);
  const out: ReleaseRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('content_releases').select(RELEASE_COLUMNS).eq('content_kind', kind).is('revoked_at', null).eq('decision', 'APPROVED').order('id').range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as ReleaseRow[]).filter((r) => wanted.has(r.content_id)));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Map id → active release (for its current hash), or absent when gated. */
export async function releaseMap(kind: ReleaseKind, current: Array<{ id: string; hash: string }>): Promise<Map<string, ReleaseRow>> {
  const rows = await activeReleases(kind, current.map((c) => c.id));
  const hashOf = new Map(current.map((c) => [c.id, c.hash]));
  const out = new Map<string, ReleaseRow>();
  for (const r of rows) if (releaseActive(r, hashOf.get(r.content_id) ?? '')) out.set(r.content_id, r);
  return out;
}

const ITEM_COLUMNS = 'item_id, module, unit_id, item_type, level, pool, section, requires_audio, scoring_strategy, competency_ids, prerequisite_ids, audio_job_ids, error_tags, envelope, current_hash';

export async function loadItems(ids: string[]): Promise<ItemRow[]> {
  if (!ids.length) return [];
  const out: ItemRow[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await adminClient().from('items').select(ITEM_COLUMNS).in('item_id', ids.slice(i, i + 200));
    if (error) throw error;
    out.push(...((data ?? []) as ItemRow[]));
  }
  const order = new Map(ids.map((id, i) => [id, i]));
  return out.sort((a, b) => (order.get(a.item_id) ?? 0) - (order.get(b.item_id) ?? 0));
}

export async function loadItem(id: string): Promise<ItemRow | null> {
  const [row] = await loadItems([id]);
  return row ?? null;
}

export async function loadTextObjects(ids: string[]): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  if (!ids.length) return out;
  const { data, error } = await adminClient().from('content_objects').select('object_id, payload').in('object_id', ids);
  if (error) throw error;
  for (const r of data ?? []) out.set(r.object_id, r.payload as Record<string, unknown>);
  return out;
}

export interface PlayableAudio {
  audio_id: string;
  asset_id: string;
  object_path: string;
  duration_ms: number | null;
  dev_only?: true;
}

/**
 * Owner preview in local development only (ALLOW_LOCAL_VOICE_PLAYBACK_FOR_DEV=1): digitally
 * checked assets rendered with a local, non-distributable voice (DEV_LOCAL_ONLY). Never a learner
 * path, never released, never counted as audio readiness.
 */
export async function devPreviewAudio(audioIds: string[]): Promise<Map<string, PlayableAudio>> {
  const out = new Map<string, PlayableAudio>();
  if (!audioIds.length || !env.allowLocalVoicePlayback) return out;
  const db = adminClient();
  const [{ data: jobs }, { data: assets }] = await Promise.all([
    db.from('audio_jobs').select('audio_id, script_hash').in('audio_id', audioIds),
    db.from('audio_assets').select('id, audio_id, script_hash, object_path, duration_ms').in('audio_id', audioIds).is('invalidated_at', null)
      .eq('digital_status', 'AUDIO_VERIFIED_DIGITAL').eq('rights_status', 'DEV_LOCAL_ONLY').order('created_at', { ascending: false }),
  ]);
  const scriptHash = new Map((jobs ?? []).map((j) => [j.audio_id, j.script_hash]));
  for (const a of assets ?? []) {
    if (a.script_hash === scriptHash.get(a.audio_id) && a.object_path && !out.has(a.audio_id)) out.set(a.audio_id, { audio_id: a.audio_id, asset_id: a.id, object_path: a.object_path, duration_ms: a.duration_ms, dev_only: true });
  }
  return out;
}

/**
 * Audio is playable for learners only when a non-invalidated synthesized asset for the current
 * script hash passed digital QA, has provider terms recorded and holds an active owner release.
 */
export async function playableAudio(audioIds: string[]): Promise<Map<string, PlayableAudio>> {
  const out = new Map<string, PlayableAudio>();
  if (!audioIds.length) return out;
  const db = adminClient();
  const [{ data: jobs }, { data: assets }] = await Promise.all([
    db.from('audio_jobs').select('audio_id, script_hash').in('audio_id', audioIds),
    db.from('audio_assets').select('id, audio_id, script_hash, object_path, sha256, duration_ms, digital_status, rights_status, invalidated_at')
      .in('audio_id', audioIds).is('invalidated_at', null).eq('digital_status', 'AUDIO_VERIFIED_DIGITAL').eq('rights_status', 'PROVIDER_TERMS_RECORDED'),
  ]);
  const scriptHash = new Map((jobs ?? []).map((j) => [j.audio_id, j.script_hash]));
  const candidates = (assets ?? []).filter((a) => a.script_hash === scriptHash.get(a.audio_id) && a.object_path && a.sha256);
  const released = await releaseMap('audio_asset', candidates.map((a) => ({ id: a.id, hash: a.sha256 as string })));
  for (const a of candidates) {
    if (released.has(a.id) && !out.has(a.audio_id)) out.set(a.audio_id, { audio_id: a.audio_id, asset_id: a.id, object_path: a.object_path!, duration_ms: a.duration_ms });
  }
  return out;
}

export interface ItemAccess {
  released: boolean;
  audioReady: boolean;
  learnerUsable: boolean;
  reason: 'OK' | 'CONTENT_GATED' | 'AUDIO_PENDING';
}

export function itemAccess(row: ItemRow, releases: Map<string, ReleaseRow>, audio: Map<string, PlayableAudio>): ItemAccess {
  const released = releases.has(row.item_id);
  // requires_audio without audio jobs = the learner must SPEAK (no stimulus audio to wait for);
  // that is enforced at answer time (voice + confirmed transcript), not by gating the item.
  const audioReady = !row.requires_audio || row.audio_job_ids.length === 0 || row.audio_job_ids.every((a) => audio.has(a));
  return { released, audioReady, learnerUsable: released && audioReady, reason: !released ? 'CONTENT_GATED' : !audioReady ? 'AUDIO_PENDING' : 'OK' };
}

export async function signedAudioUrl(objectPath: string, bucket = 'course-audio', seconds = 300): Promise<string | null> {
  const { data } = await adminClient().storage.from(bucket).createSignedUrl(objectPath, seconds);
  return data?.signedUrl ?? null;
}
