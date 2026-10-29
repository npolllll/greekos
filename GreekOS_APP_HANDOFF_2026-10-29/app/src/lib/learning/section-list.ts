import { adminClient, selectAll } from '../supabase/admin.ts';
import { deliverItems } from '../content/delivery.ts';
import type { ItemRow } from '../content/repo.ts';

const COLS = 'item_id, module, unit_id, item_type, level, pool, section, requires_audio, scoring_strategy, competency_ids, prerequisite_ids, audio_job_ids, error_tags, envelope, current_hash';

/** Items of one lesson section across the course with learner availability (no keys). */
export async function sectionItems(section: 'listening' | 'writing' | 'speaking') {
  const db = adminClient();
  const rows = await selectAll<ItemRow>((f, t) => db.from('items').select(COLS).eq('module', 'core').eq('section', section).order('item_id').range(f, t));
  const { data: units } = await db.from('units').select('unit_id, title_ru, level, sort_key');
  const delivered = await deliverItems(rows);
  const unitMap = new Map((units ?? []).map((u) => [u.unit_id, u]));
  return delivered.map((d) => ({ ...d, unit: unitMap.get(rows.find((r) => r.item_id === d.dto.item_id)?.unit_id ?? '') ?? null }))
    .sort((a, b) => (a.unit?.sort_key ?? 0) - (b.unit?.sort_key ?? 0) || a.dto.item_id.localeCompare(b.dto.item_id));
}
