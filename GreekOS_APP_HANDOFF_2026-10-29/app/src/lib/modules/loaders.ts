import { adminClient, selectAll } from '../supabase/admin.ts';
import { releaseMap, PUBLIC_VIEWER, type ItemRow, type Viewer } from '../content/repo.ts';
import { deliverItems, type DeliveredItem } from '../content/delivery.ts';
import { groupCatalog, pegpSourceRefs, pegpTopicOfItem, PEGP_TOPICS, type PegpSourceRef, type PegpTopic, type RgPayload } from './display.ts';

const ITEM_COLUMNS = 'item_id, module, unit_id, item_type, level, pool, section, requires_audio, scoring_strategy, competency_ids, prerequisite_ids, audio_job_ids, error_tags, envelope, current_hash';

async function moduleItems(module: 'pegp' | 'real_greek'): Promise<ItemRow[]> {
  return selectAll<ItemRow>((f, t) => adminClient().from('items').select(ITEM_COLUMNS).eq('module', module).order('item_id').range(f, t));
}

export interface ReleaseWindow { expires_at: string | null; expired: boolean; reviewed_at: string | null; review_type: string | null }

/** Approved, non-revoked releases for the current hashes, including expired ones (to explain locks). */
export async function releaseWindows(kind: 'item' | 'pegp_packet' | 'rg_expression', current: Array<{ id: string; hash: string }>): Promise<Map<string, ReleaseWindow>> {
  const out = new Map<string, ReleaseWindow>();
  const hash = new Map(current.map((c) => [c.id, c.hash]));
  const ids = current.map((c) => c.id);
  const now = Date.now();
  for (let i = 0; i < ids.length; i += 60) {
    const { data, error } = await adminClient().from('content_releases').select('content_id, content_hash, expires_at, reviewed_at, review_type')
      .eq('content_kind', kind).eq('decision', 'APPROVED').is('revoked_at', null).in('content_id', ids.slice(i, i + 60));
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
      if (r.content_hash !== hash.get(r.content_id)) continue;
      const expired = !!r.expires_at && Date.parse(r.expires_at) <= now;
      const prev = out.get(r.content_id);
      // Prefer an active window; among active ones the latest expiry.
      if (!prev || (prev.expired && !expired) || (!expired && (r.expires_at ?? '9999') > (prev.expires_at ?? '9999'))) {
        out.set(r.content_id, { expires_at: r.expires_at, expired, reviewed_at: r.reviewed_at, review_type: r.review_type });
      }
    }
  }
  return out;
}

// ---------------- ΠΕΓΠ ----------------
export interface PegpTopicSummary {
  topic: PegpTopic;
  packets: Array<{ packet_id: string; kind: string; status: string | null; bank_version: string | null; date: string | null }>;
  mapped: number;
  available: number;
  expired: number;
}

async function singleton<T>(id: string): Promise<T | null> {
  const { data } = await adminClient().from('content_singletons').select('payload').eq('singleton_id', id).maybeSingle();
  return ((data?.payload as { payload?: T } | undefined)?.payload ?? null) as T | null;
}

export async function pegpOverview(viewer: Viewer = PUBLIC_VIEWER) {
  const db = adminClient();
  const [moduleInfo, coverage, { data: packets }, rows] = await Promise.all([
    singleton<Record<string, unknown>>('pegp_module'),
    singleton<{ documents?: Array<{ title?: string; coverage?: string; official_url?: string; catalog_doc_id?: number }>; catalog_snapshot_date?: string; status?: string; fresh_official_currentness_check?: boolean; remaining_language?: string[] }>('pegp_catalog_coverage'),
    db.from('pegp_packets').select('packet_id, topic_code, packet_kind, payload, current_hash').order('packet_id'),
    moduleItems('pegp'),
  ]);
  const delivered = await deliverItems(rows, { viewer });
  const windows = await releaseWindows('item', rows.map((r) => ({ id: r.item_id, hash: r.current_hash })));
  const topics: PegpTopicSummary[] = PEGP_TOPICS.map((t) => {
    const ds = delivered.filter((d) => pegpTopicOfItem(d.dto.item_id) === t);
    return {
      topic: t,
      packets: (packets ?? []).filter((p) => p.topic_code === t).map((p) => {
        const pl = p.payload as Record<string, unknown>;
        return { packet_id: p.packet_id, kind: p.packet_kind, status: typeof pl.status === 'string' ? pl.status : null, bank_version: typeof pl.bank_version === 'string' ? pl.bank_version : typeof pl.source_version === 'string' ? pl.source_version : null, date: typeof pl.date === 'string' ? pl.date : null };
      }),
      mapped: ds.length,
      available: ds.filter((d) => d.access.learnerUsable).length,
      expired: ds.filter((d) => windows.get(d.dto.item_id)?.expired && !d.access.released).length,
    };
  });
  const docs = coverage?.documents ?? [];
  return {
    moduleInfo,
    topics,
    totalMapped: rows.length,
    totalAvailable: delivered.filter((d) => d.access.learnerUsable).length,
    catalog: {
      status: coverage?.status ?? null,
      snapshot: coverage?.catalog_snapshot_date ?? null,
      fresh_check: coverage?.fresh_official_currentness_check ?? false,
      total: docs.length,
      pending: docs.filter((d) => d.coverage === 'NO_DIRECT_ITEM_LINK_FOUND').length,
      families: groupCatalog(docs),
      pendingDocs: docs.filter((d) => d.coverage === 'NO_DIRECT_ITEM_LINK_FOUND').map((d) => ({ title: d.title ?? '', url: d.official_url ?? null, id: d.catalog_doc_id ?? null })),
      remaining_language: coverage?.remaining_language ?? [],
    },
  };
}

export interface PegpItemView {
  delivered: DeliveredItem;
  sources: PegpSourceRef[];
  window: ReleaseWindow | null;
}

export async function pegpTopic(topic: PegpTopic, viewer: Viewer = PUBLIC_VIEWER) {
  const db = adminClient();
  const [{ data: packets }, rows] = await Promise.all([
    db.from('pegp_packets').select('packet_id, topic_code, packet_kind, payload, current_hash').eq('topic_code', topic).order('packet_kind'),
    moduleItems('pegp'),
  ]);
  const topicRows = rows.filter((r) => pegpTopicOfItem(r.item_id) === topic);
  const delivered = await deliverItems(topicRows, { viewer });
  const windows = await releaseWindows('item', topicRows.map((r) => ({ id: r.item_id, hash: r.current_hash })));
  const packetRel = await releaseMap('pegp_packet', (packets ?? []).map((p) => ({ id: p.packet_id, hash: p.current_hash })), viewer);
  const items: PegpItemView[] = delivered.map((d) => ({
    delivered: d,
    sources: pegpSourceRefs(topicRows.find((r) => r.item_id === d.dto.item_id)?.envelope.original_payload),
    window: windows.get(d.dto.item_id) ?? null,
  }));
  return {
    packets: (packets ?? []).map((p) => ({ packet_id: p.packet_id, kind: p.packet_kind, payload: p.payload as Record<string, unknown>, released: packetRel.has(p.packet_id) })),
    items,
  };
}

// ---------------- Real Greek ----------------
export interface RgExpressionView {
  expression_id: string;
  expression: string;
  payload: RgPayload;
  released: boolean;
  dev_preview?: boolean;
}

export async function rgExpressions(viewer: Viewer = PUBLIC_VIEWER): Promise<RgExpressionView[]> {
  const { data, error } = await adminClient().from('rg_expressions').select('expression_id, expression, payload, current_hash').order('expression_id');
  if (error) throw new Error(error.message);
  const rel = await releaseMap('rg_expression', (data ?? []).map((r) => ({ id: r.expression_id, hash: r.current_hash })), viewer);
  return (data ?? []).map((r) => ({ expression_id: r.expression_id, expression: r.expression, payload: r.payload as RgPayload, released: rel.has(r.expression_id), dev_preview: rel.get(r.expression_id)?.review_type === 'DEV_PREVIEW_LOCAL' }));
}

export async function rgItems(expressionId: string, viewer: Viewer = PUBLIC_VIEWER): Promise<DeliveredItem[]> {
  const rows = (await moduleItems('real_greek')).filter((r) => r.item_id.startsWith(`${expressionId}-`));
  return deliverItems(rows, { viewer });
}
