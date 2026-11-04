import { afterAll, describe, expect, it } from 'vitest';
import { admin } from './helpers';
import { buildLessonQa, lessonQaMarkdown } from '@/lib/qa/lesson-report';

/**
 * Content QA per lesson (mandate: «сохрани результаты содержательной проверки по каждому уроку»).
 * The report follows the latest digital run on each object's current hash, and never presents
 * automatic checks as a teacher's or native speaker's review.
 */
let batchId = '';
afterAll(async () => { if (batchId) await admin.from('qa_batches').delete().eq('id', batchId); });

describe('lesson QA report', () => {
  it('covers every lesson with all dimensions and states that no human review took place', async () => {
    const { count } = await admin.from('units').select('unit_id', { count: 'exact', head: true });
    const rows = await buildLessonQa();
    expect(rows.length).toBe(count);
    for (const r of rows) {
      expect(r.dimensions.map((d) => d.id)).toEqual(['completeness', 'language', 'answers', 'explanations', 'cefr', 'logic', 'theory', 'rights', 'audio', 'human']);
      expect(r.dimensions.find((d) => d.id === 'human')?.status).toBe('not_done');
      expect(r.verdicts.PASS + r.verdicts.NEEDS_REVIEW + r.verdicts.FAIL + r.verdicts.ABSTAIN + r.verdicts.NOT_CHECKED).toBe(r.items_total);
    }
    const md = lessonQaMarkdown(rows, 'test');
    expect(md).toContain('Это не проверка преподавателем или носителем языка');
    expect(md).not.toMatch(/HUMAN_VERIFIED|проверено преподавателем/);
  });

  it('a newer FAIL on an item’s current hash makes its lesson «needs fix»', async () => {
    const [before] = await buildLessonQa({ unitIds: ['U-A1-007'] });
    expect(before.summary).not.toBe('NEEDS_FIX');
    const { data: item } = await admin.from('items').select('item_id, current_hash').eq('unit_id', 'U-A1-007').order('item_id').limit(1).single();
    const { data: batch, error } = await admin.from('qa_batches').insert({ label: 'SYN-TEST lesson QA', scope: { kind: 'test' }, tool_version: 'test', status: 'COMPLETED', finished_at: new Date(Date.now() + 1000).toISOString() }).select('id').single();
    if (error) throw error;
    batchId = batch.id;
    await admin.from('qa_item_results').insert({ batch_id: batchId, content_kind: 'item', content_id: item!.item_id, content_hash: item!.current_hash, unit_id: 'U-A1-007', module: 'core', verdict: 'FAIL', checks: [], blocking_count: 1, warning_count: 0 });
    await admin.from('qa_issues').insert({ batch_id: batchId, content_kind: 'item', content_id: item!.item_id, content_hash: item!.current_hash, check_id: 'keys.present', severity: 'blocking', field: 'answer', message_ru: 'Нет ключа (тест).', evidence: {}, status: 'open' });
    const [after] = await buildLessonQa({ unitIds: ['U-A1-007'] });
    expect(after.summary).toBe('NEEDS_FIX');
    expect(after.verdicts.FAIL).toBe(1);
    expect(after.dimensions.find((d) => d.id === 'answers')?.status).toBe('block');
    expect(after.top_issues[0]).toMatchObject({ object: item!.item_id, severity: 'blocking' });
  });
});
