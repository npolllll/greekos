import { adminClient } from '../supabase/admin.ts';
import { localDateOf } from './calendar.ts';
import { deriveCompetencyState, type MasteryEventLite, type MasteryState } from './mastery.ts';

/** Recompute the derived competency read model from the append-only event log. */
export async function refreshCompetencyState(userId: string, competencyIds: string[], timezone: string): Promise<Array<{ competency_id: string; state: MasteryState; changed: boolean }>> {
  if (!competencyIds.length) return [];
  const db = adminClient();
  const today = localDateOf(new Date(), timezone);
  const [{ data: events }, { data: reviews }, { data: current }, { data: frozen }] = await Promise.all([
    db.from('mastery_events').select('event_id, competency_id, event_type, task_kind, reliable, meaning_changing, item_id, review_interval_days, local_date, created_at, supersedes_id, attempt_id').eq('user_id', userId).in('competency_id', competencyIds),
    db.from('spaced_reviews').select('competency_id, status, due_local_date').eq('user_id', userId).in('competency_id', competencyIds).eq('status', 'due'),
    db.from('competency_state').select('competency_id, state').eq('user_id', userId).in('competency_id', competencyIds),
    db.from('assessments').select('attempt_id').eq('user_id', userId).eq('status', 'UNDER_APPEAL'),
  ]);
  const frozenAttempts = new Set((frozen ?? []).map((f) => f.attempt_id));
  const prev = new Map((current ?? []).map((c) => [c.competency_id, c.state]));
  const results: Array<{ competency_id: string; state: MasteryState; changed: boolean }> = [];
  for (const cid of competencyIds) {
    const evs = (events ?? []).filter((e) => e.competency_id === cid).map((e) => ({ ...e, frozen: !!e.attempt_id && frozenAttempts.has(e.attempt_id) })) as MasteryEventLite[];
    const due = (reviews ?? []).some((r) => r.competency_id === cid && r.due_local_date <= today);
    const { state, summary } = deriveCompetencyState(evs, due);
    if (state === 'unseen' && !prev.has(cid)) continue;
    await db.from('competency_state').upsert({ user_id: userId, competency_id: cid, state, summary, updated_at: new Date().toISOString() });
    results.push({ competency_id: cid, state, changed: prev.get(cid) !== state });
  }
  return results;
}

export async function emitEvent(userId: string, eventType: string, idempotencyKey: string, payload: Record<string, unknown> = {}) {
  await adminClient().from('learner_events').upsert(
    { user_id: userId, event_type: eventType, idempotency_key: idempotencyKey, payload },
    { onConflict: 'user_id,event_type,idempotency_key', ignoreDuplicates: true },
  );
}
