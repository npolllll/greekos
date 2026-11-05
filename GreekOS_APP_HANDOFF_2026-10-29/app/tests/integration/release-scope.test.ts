import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, synItem, upsertSynItem } from './helpers';
import { pickSample, sampleSize, scopeStatus } from '@/lib/qa/release';

/**
 * What the owner's release decision may open. Regression: a task whose QA verdict is FAIL became
 * «ready» once a later QA run had marked its issues «superseded» and that run was deleted — the state
 * looked only at open issues. FAIL and unresolved (open or superseded) blocking issues stay closed;
 * only the owner's explicit resolution (false positive / accepted risk) or a fixing revision opens them.
 */
const IDS = ['SYN-REL-PASS', 'SYN-REL-FAIL', 'SYN-REL-SUPERSEDED'];
let batchId = '';
const hashes: Record<string, string> = {};

beforeAll(async () => {
  for (const id of IDS) hashes[id] = await upsertSynItem(synItem(id, {}));
  const { data: batch, error } = await admin.from('qa_batches').insert({ label: 'SYN-TEST release scope', scope: { kind: 'test' }, tool_version: 'test', status: 'COMPLETED', finished_at: new Date().toISOString() }).select('id').single();
  if (error) throw error;
  batchId = batch.id;
  const result = (id: string, verdict: string) => ({ batch_id: batchId, content_kind: 'item', content_id: id, content_hash: hashes[id], unit_id: null, module: 'synthetic_fixture', verdict, checks: [], blocking_count: verdict === 'FAIL' ? 1 : 0, warning_count: 0 });
  await admin.from('qa_item_results').insert([result('SYN-REL-PASS', 'PASS'), result('SYN-REL-FAIL', 'FAIL'), result('SYN-REL-SUPERSEDED', 'FAIL')]);
  const issue = (id: string, status: string) => ({ batch_id: batchId, content_kind: 'item', content_id: id, content_hash: hashes[id], check_id: 'rights.license', severity: 'blocking', field: 'licensing', message_ru: 'Права ограничены.', evidence: {}, status });
  // FAIL without a stored issue row, and FAIL whose issue was superseded by a run that no longer exists.
  await admin.from('qa_issues').insert([issue('SYN-REL-SUPERSEDED', 'superseded')]);
});

afterAll(async () => {
  await admin.from('qa_batches').delete().eq('id', batchId);
  await admin.from('items').delete().in('item_id', IDS);
  await admin.from('content_revisions').delete().in('content_id', IDS);
});

describe('release scope', () => {
  it('FAIL verdicts and superseded blocking issues stay closed; PASS opens', async () => {
    const st = await scopeStatus(batchId, { kind: 'items', ids: IDS });
    const state = Object.fromEntries(st.objects.map((o) => [o.content_id, o.state]));
    expect(state).toEqual({ 'SYN-REL-PASS': 'PASS', 'SYN-REL-FAIL': 'BLOCKED', 'SYN-REL-SUPERSEDED': 'BLOCKED' });
    expect(st.releasable).toBe(1);
  });

  it('the owner sample is 10% of the tasks, at least 5, at most 30, one of each type first', () => {
    expect([3, 40, 300, 1800].map(sampleSize)).toEqual([3, 5, 30, 30]);
    const items = Array.from({ length: 200 }, (_, i) => ({ content_id: `X-${i}`, item_type: i < 190 ? 'mcq' : `type_${i}` }));
    const sample = pickSample('batch', items);
    expect(sample).toHaveLength(20);
    // Every one of the 11 types is in the sample although 10 of them are rare.
    expect(new Set(sample.map((s) => s.item_type)).size).toBe(11);
    expect(pickSample('batch', items).map((s) => s.content_id)).toEqual(sample.map((s) => s.content_id));
  });
});
