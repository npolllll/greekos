import { adminClient, selectAll } from '../supabase/admin.ts';
import { releaseMap, playableAudio, itemAccess, PUBLIC_VIEWER, type ItemRow, type Viewer } from '../content/repo.ts';

export interface UnitSummary {
  unit_id: string;
  level: string;
  title_ru: string;
  sort_key: number;
  prerequisites: string[];
  primary_competencies: string[];
  estimated_active_minutes: number | null;
  current_hash: string;
  released: boolean;
  item_total: number;
  item_usable: number;
  item_audio_pending: number;
  completed: boolean;
  started: boolean;
  /** Opened only through the owner-granted DEV-PREVIEW (not released). */
  dev_preview: boolean;
  skippable_by_placement: boolean;
}

/** Product route order: absolute beginners start with the alphabet and sounds (U-A1-007, U-A1-008). */
export const FOUNDATION_UNITS = ['U-A1-007', 'U-A1-008'];

export function routeOrder<T extends { unit_id: string; sort_key: number }>(units: T[]): T[] {
  const sorted = [...units].sort((a, b) => a.sort_key - b.sort_key);
  const first = FOUNDATION_UNITS.map((id) => sorted.find((u) => u.unit_id === id)).filter(Boolean) as T[];
  return [...first, ...sorted.filter((u) => !FOUNDATION_UNITS.includes(u.unit_id))];
}

export async function loadCourse(userId: string, viewer: Viewer = PUBLIC_VIEWER): Promise<{ units: UnitSummary[]; startUnitId: string | null; routeKind: string | null }> {
  const db = adminClient();
  const [{ data: units }, items, { data: sessions }, { data: route }] = await Promise.all([
    db.from('units').select('unit_id, level, title_ru, sort_key, prerequisites, primary_competencies, estimated_active_minutes, current_hash'),
    selectAll<ItemRow>((f, t) => db.from('items').select('item_id, unit_id, current_hash, requires_audio, audio_job_ids, section, pool, module, item_type, level, scoring_strategy, competency_ids, prerequisite_ids, error_tags').eq('module', 'core').not('unit_id', 'is', null).order('item_id').range(f, t)),
    db.from('lesson_sessions').select('unit_id, status').eq('user_id', userId).eq('preview', false),
    db.from('learning_routes').select('route_kind, start_unit_id').eq('user_id', userId).maybeSingle(),
  ]);
  const unitRel = await releaseMap('unit', (units ?? []).map((u) => ({ id: u.unit_id, hash: u.current_hash })), viewer);
  const itemRows = items;
  const itemRel = await releaseMap('item', itemRows.map((i) => ({ id: i.item_id, hash: i.current_hash })), viewer);
  const audio = await playableAudio([...new Set(itemRows.flatMap((i) => i.audio_job_ids))], viewer);
  const ordered = routeOrder((units ?? []) as UnitSummary[]);
  const startIdx = route?.start_unit_id ? ordered.findIndex((u) => u.unit_id === route.start_unit_id) : -1;
  const summaries = ordered.map((u, idx) => {
    const its = itemRows.filter((i) => i.unit_id === u.unit_id && i.section !== 'diagnostic');
    const acc = its.map((i) => itemAccess(i, itemRel, audio));
    const s = (sessions ?? []).filter((x) => x.unit_id === u.unit_id);
    return {
      ...u,
      released: unitRel.has(u.unit_id),
      dev_preview: unitRel.get(u.unit_id)?.review_type === 'DEV_PREVIEW_LOCAL',
      item_total: its.length,
      item_usable: acc.filter((a) => a.learnerUsable).length,
      item_audio_pending: acc.filter((a) => a.released && !a.audioReady).length,
      completed: s.some((x) => x.status === 'COMPLETED'),
      started: s.length > 0,
      skippable_by_placement: startIdx > 0 && idx < startIdx && !FOUNDATION_UNITS.includes(u.unit_id),
    };
  });
  return { units: summaries, startUnitId: route?.start_unit_id ?? null, routeKind: route?.route_kind ?? null };
}

/** Next recommended unit: first released, uncompleted unit from the learner's start pointer. */
export function nextUnit(course: { units: UnitSummary[]; startUnitId: string | null }): UnitSummary | null {
  const start = course.startUnitId ? course.units.findIndex((u) => u.unit_id === course.startUnitId) : 0;
  const tail = course.units.slice(Math.max(0, start));
  return tail.find((u) => u.released && !u.completed) ?? null;
}
