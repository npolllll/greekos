import { describe, expect, it } from 'vitest';
import { admin } from './helpers';
import { applyExplanationRevisions, applyReadingItems, applyUnitOrderRevisions, CONTENT_REVISION_ACTOR, EXPLANATION_REVISIONS } from '@/lib/qa/content-revisions';
import { READING_ITEMS } from '@/lib/qa/data/reading-items';
import { buildLessonQa } from '@/lib/qa/lesson-report';
import { routeOrder } from '@/lib/learning/course';

/**
 * The methodological revisions are reproducible on any database (deploy step 6) and idempotent, keep
 * their history as recorded revisions by a named system actor, and leave no lesson without connected
 * reading or listening, Greek-only explanations or a prerequisite taught later.
 */
describe('methodological content revisions', () => {
  it('apply once and then report «already»', async () => {
    await applyUnitOrderRevisions(); await applyExplanationRevisions(); await applyReadingItems();
    expect((await applyUnitOrderRevisions()).status).toBe('already');
    expect((await applyExplanationRevisions()).every((x) => x.status === 'already')).toBe(true);
    expect((await applyReadingItems()).every((x) => x.status === 'already')).toBe(true);
  });

  it('are recorded as revisions of a named system actor, never as a person', async () => {
    const ids = [...EXPLANATION_REVISIONS.map((r) => r.item_id), ...READING_ITEMS.map((r) => r.item_id)];
    const { data } = await admin.from('content_patches').select('content_id, created_by, system_actor').in('content_id', ids);
    expect(new Set((data ?? []).map((p) => p.content_id)).size).toBe(ids.length);
    for (const p of data ?? []) { expect(p.created_by).toBeNull(); expect(p.system_actor).toBe(CONTENT_REVISION_ACTOR); }
  });

  it('new reading tasks appear in the lesson plan and in the «reading» step', async () => {
    const { data: items } = await admin.from('items').select('item_id, unit_id, section').in('item_id', READING_ITEMS.map((r) => r.item_id));
    expect(items).toHaveLength(READING_ITEMS.length);
    for (const it of items ?? []) expect(it.section).toBe('reading');
    const { data: units } = await admin.from('units').select('unit_id, teaching').in('unit_id', READING_ITEMS.map((r) => r.unit_id));
    for (const u of units ?? []) {
      const t = u.teaching as { reading_tasks?: string[]; sections?: { reception?: string[] } };
      const id = READING_ITEMS.find((r) => r.unit_id === u.unit_id)!.item_id;
      expect(t.reading_tasks).toContain(id);
      expect(t.sections?.reception).toContain(id);
    }
  });

  it('the route teaches B1-G10 before the lesson that requires it', async () => {
    const { data } = await admin.from('units').select('unit_id, sort_key');
    const order = routeOrder(data ?? []).map((u) => u.unit_id);
    expect(order.indexOf('U-B1-008')).toBeLessThan(order.indexOf('U-B1-007'));
  });

  it('the per-lesson content report has no remaining warnings in these dimensions', async () => {
    const rows = await buildLessonQa();
    const open = rows.flatMap((r) => r.dimensions.filter((d) => ['completeness', 'explanations', 'logic'].includes(d.id) && d.status !== 'ok').map((d) => `${r.unit_id}:${d.id}`));
    expect(open).toEqual([]);
  });
});
