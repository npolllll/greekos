import 'server-only';
import { adminClient, selectAll } from '../supabase/admin.ts';
import { itemAccess, playableAudio, releaseMap, type ItemRow } from '../content/repo.ts';
import { addDays, localDateOf, weekdayShortRu } from '../learning/calendar.ts';

export interface CohortRow {
  user_id: string;
  display_name: string;
  email: string | null;
  active: boolean;
  lifecycle_state: string;
  entry_path: string | null;
  start_date: string | null;
  route_start: string | null;
  lessons_completed: number;
  attempts: number;
  active_seconds: number;
  weakest: string | null;
  last_activity: string | null;
  pending_reviews: number;
}

/** Owner analytics from real learner rows only (no demo numbers). */
export async function loadCohort(): Promise<CohortRow[]> {
  const db = adminClient();
  const { data: roles } = await db.from('role_assignments').select('user_id').eq('role', 'learner');
  const ids = (roles ?? []).map((r) => r.user_id);
  if (!ids.length) return [];
  const [profiles, enr, routes, lessons, attempts, act, states, comps, axes, pending, events] = await Promise.all([
    db.from('profiles').select('user_id, display_name, email, active, lifecycle_state, entry_path').in('user_id', ids),
    db.from('enrollments').select('user_id, start_date').in('user_id', ids),
    db.from('learning_routes').select('user_id, start_unit_id').in('user_id', ids),
    db.from('lesson_sessions').select('user_id').in('user_id', ids).eq('status', 'COMPLETED').eq('preview', false),
    selectAll<{ user_id: string }>((f, t) => db.from('attempts').select('user_id').in('user_id', ids).eq('preview', false).order('attempt_id').range(f, t)),
    selectAll<{ user_id: string; local_date: string; active_seconds: number }>((f, t) => db.from('activity_days').select('user_id, local_date, active_seconds').in('user_id', ids).order('local_date').range(f, t)),
    db.from('competency_state').select('user_id, competency_id, state, updated_at').in('user_id', ids).eq('state', 'needs_review').order('updated_at', { ascending: false }),
    db.from('competencies').select('competency_id, name').eq('scope', 'core'),
    db.from('placement_axis_results').select('user_id, axis, candidate_start, status, updated_at').in('user_id', ids),
    db.from('assessments').select('user_id').in('user_id', ids).in('verdict', ['PENDING_REVIEW', 'ABSTAIN']).eq('status', 'ACTIVE'),
    db.from('learner_events').select('user_id, occurred_at').in('user_id', ids).order('occurred_at', { ascending: false }).limit(500),
  ]);
  const names = new Map((comps.data ?? []).map((c) => [c.competency_id, c.name as string]));
  const count = <T extends { user_id: string }>(rows: T[] | null | undefined, uid: string) => (rows ?? []).filter((r) => r.user_id === uid).length;
  const LEVEL_ORDER = ['A0', 'A1', 'A2', 'B1', 'B2'];
  return (profiles.data ?? []).map((p) => {
    const weakComp = (states.data ?? []).find((s) => s.user_id === p.user_id);
    const userAxes = (axes.data ?? []).filter((a) => a.user_id === p.user_id && a.candidate_start);
    const weakestAxis = userAxes.sort((a, b) => LEVEL_ORDER.indexOf(a.candidate_start as string) - LEVEL_ORDER.indexOf(b.candidate_start as string))[0];
    const days = act.filter((a) => a.user_id === p.user_id);
    const lastDay = days.at(-1)?.local_date ?? null;
    const lastEvent = (events.data ?? []).find((e) => e.user_id === p.user_id)?.occurred_at ?? null;
    return {
      user_id: p.user_id, display_name: p.display_name, email: p.email, active: p.active, lifecycle_state: p.lifecycle_state, entry_path: p.entry_path,
      start_date: (enr.data ?? []).find((e) => e.user_id === p.user_id)?.start_date ?? null,
      route_start: (routes.data ?? []).find((r) => r.user_id === p.user_id)?.start_unit_id ?? null,
      lessons_completed: count(lessons.data, p.user_id),
      attempts: count(attempts, p.user_id),
      active_seconds: days.reduce((a, d) => a + (d.active_seconds ?? 0), 0),
      weakest: weakComp ? names.get(weakComp.competency_id) ?? weakComp.competency_id : weakestAxis ? `${weakestAxis.axis} (диагностика: ${weakestAxis.candidate_start})` : null,
      last_activity: lastEvent ?? lastDay,
      pending_reviews: count(pending.data, p.user_id),
    };
  }).sort((a, b) => a.display_name.localeCompare(b.display_name, 'ru'));
}

/** Seven local days of summed active minutes across learners (owner timezone). */
export async function groupWeek(timezone: string) {
  const db = adminClient();
  const today = localDateOf(new Date(), timezone);
  const start = addDays(today, -6);
  const rows = await selectAll<{ local_date: string; active_seconds: number }>((f, t) => db.from('activity_days').select('local_date, active_seconds').gte('local_date', start).order('local_date').range(f, t));
  return Array.from({ length: 7 }, (_, i) => {
    const d = addDays(start, i);
    return { date: d, label: weekdayShortRu(d), minutes: Math.round(rows.filter((r) => r.local_date === d).reduce((a, r) => a + r.active_seconds, 0) / 60) };
  });
}

const ITEM_LITE = 'item_id, module, unit_id, item_type, level, pool, section, requires_audio, scoring_strategy, competency_ids, prerequisite_ids, audio_job_ids, error_tags, current_hash';

export async function loadItemsLite(): Promise<ItemRow[]> {
  const db = adminClient();
  return selectAll<ItemRow>((f, t) => db.from('items').select(ITEM_LITE).order('item_id').range(f, t));
}

export interface ItemStatus { item: ItemRow; released: boolean; audioReady: boolean; usable: boolean }

export async function itemStatuses(items?: ItemRow[]): Promise<ItemStatus[]> {
  const rows = items ?? (await loadItemsLite());
  const [rel, audio] = await Promise.all([
    releaseMap('item', rows.map((r) => ({ id: r.item_id, hash: r.current_hash }))),
    playableAudio([...new Set(rows.flatMap((r) => r.audio_job_ids))]),
  ]);
  return rows.map((r) => {
    const a = itemAccess(r, rel, audio);
    return { item: r, released: a.released, audioReady: a.audioReady, usable: a.learnerUsable };
  });
}

export async function verifiedAudioCount(): Promise<{ verified: number; released: number; jobs: number; jobsWithPlayable: number }> {
  const db = adminClient();
  const [{ data: assets }, { data: jobs }] = await Promise.all([
    db.from('audio_assets').select('id, audio_id, sha256, digital_status, rights_status, invalidated_at').is('invalidated_at', null).eq('digital_status', 'AUDIO_VERIFIED_DIGITAL'),
    db.from('audio_jobs').select('audio_id'),
  ]);
  const verified = assets ?? [];
  const rel = await releaseMap('audio_asset', verified.filter((a) => a.sha256).map((a) => ({ id: a.id, hash: a.sha256 as string })));
  const playable = await playableAudio((jobs ?? []).map((j) => j.audio_id));
  return { verified: verified.length, released: verified.filter((a) => rel.has(a.id) && a.rights_status === 'PROVIDER_TERMS_RECORDED').length, jobs: (jobs ?? []).length, jobsWithPlayable: playable.size };
}
