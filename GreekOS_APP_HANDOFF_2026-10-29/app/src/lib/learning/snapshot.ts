import { adminClient, selectAll } from '../supabase/admin.ts';
import { releaseMap, playableAudio, itemAccess, PUBLIC_VIEWER, type ItemRow, type Viewer } from '../content/repo.ts';
import { addDays, localDateOf, planEndDate, planProgress, diffDays, inUtcWindow, weekdayShortRu, type LocalDate } from './calendar.ts';
import { splitBudget, redistribute, rankWeak, orderItems, prerequisiteOutdegree, itemEligibility, type Budget, type FallbackLog } from './planner.ts';
import { loadCourse, nextUnit, FOUNDATION_UNITS, type UnitSummary } from './course.ts';
import type { MasteryState } from './mastery.ts';

export interface PlanBlock {
  kind: 'new_content' | 'retention' | 'correction' | 'independent_application';
  title_ru: string;
  minutes: number;
  href: string | null;
  detail_ru: string;
  available: boolean;
}

export interface LearnerSnapshot {
  generated_at: string;
  today: LocalDate;
  timezone: string;
  enrollment: { start_date: LocalDate | null; end_date: LocalDate | null; exam_date: LocalDate | null; daily_minutes: number; elapsed_days: number; total_days: number } | null;
  stats: { active_days_streak: number; lessons_completed: number; attempts_total: number; minutes_7d: number; reliable_correct_7d: number };
  week: Array<{ date: LocalDate; label: string; minutes: number }>;
  competencies: Record<MasteryState, number>;
  mastered_competencies: number;
  reviews: { due_today: number; next_due: LocalDate | null; upcoming: Array<{ competency_id: string; interval_days: number; due_local_date: LocalDate }> };
  errors: { open: number; recent: Array<{ id: string; competency_id: string | null; competency_name: string | null; created_at: string; error_kind: string | null }> };
  pending_review: number;
  plan: { status: 'OK' | 'NO_ELIGIBLE_CONTENT' | 'NOT_STARTED'; budget: Budget; log: FallbackLog; blocks: PlanBlock[] };
  next_unit: Pick<UnitSummary, 'unit_id' | 'title_ru' | 'level' | 'item_usable' | 'item_total' | 'estimated_active_minutes' | 'dev_preview'> | null;
  content: { units_released: number; units_total: number; items_usable: number; dev_preview_units: number };
  events: Array<{ id: number; event_type: string; occurred_at: string; payload: Record<string, unknown> }>;
  route: { kind: string | null; start_unit_id: string | null };
  /** Position on the A0–B2 route from real lesson completions (A0 = alphabet & sounds foundations). */
  level: { code: 'A0' | 'A1' | 'A2' | 'B1' | 'B2'; label_ru: string; completed: number; total: number; pct: number };
  competencies_total: number;
  lifecycle_state: string;
  entry_path: string | null;
}

const EMPTY_STATES: Record<MasteryState, number> = { unseen: 0, familiar: 0, recognition: 0, controlled: 0, spontaneous: 0, retention_due: 0, retained: 0, transfer_confirmed: 0, needs_review: 0, insufficient_evidence: 0 };

export async function learnerSnapshot(userId: string, timezone: string, profile: { lifecycle_state: string; entry_path: string | null }, viewer: Viewer = PUBLIC_VIEWER): Promise<LearnerSnapshot> {
  const db = adminClient();
  const now = new Date();
  const today = localDateOf(now, timezone);
  const weekStart = addDays(today, -6);
  const [enr, act, comps, reviews, errs, pending, events, lessonsDone, attemptsTotal, masteryRecent, compNames, items] = await Promise.all([
    db.from('enrollments').select('start_date, end_date, exam_date, daily_minutes').eq('user_id', userId).maybeSingle(),
    db.from('activity_days').select('local_date, active_seconds, attempts').eq('user_id', userId).gte('local_date', addDays(today, -60)).order('local_date'),
    db.from('competency_state').select('competency_id, state').eq('user_id', userId),
    db.from('spaced_reviews').select('id, competency_id, interval_days, due_local_date, anchor_item_id, status').eq('user_id', userId).eq('status', 'due').order('due_local_date'),
    db.from('error_evidence').select('id, competency_id, created_at, error_kind, status').eq('user_id', userId).in('status', ['open', 'practised']).order('created_at', { ascending: false }).limit(50),
    db.from('assessments').select('assessment_id', { count: 'exact', head: true }).eq('user_id', userId).eq('verdict', 'PENDING_REVIEW').eq('status', 'ACTIVE'),
    db.from('learner_events').select('id, event_type, occurred_at, payload').eq('user_id', userId).order('occurred_at', { ascending: false }).limit(8),
    db.from('lesson_sessions').select('unit_id', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'COMPLETED').eq('preview', false),
    db.from('attempts').select('attempt_id', { count: 'exact', head: true }).eq('user_id', userId).eq('preview', false),
    db.from('mastery_events').select('competency_id, event_type, reliable, meaning_changing, created_at, item_id').eq('user_id', userId).gte('created_at', new Date(now.getTime() - 14 * 86_400_000).toISOString()),
    db.from('competencies').select('competency_id, name, prerequisites').eq('scope', 'core'),
    selectAll<ItemRow>((f, t) => db.from('items').select('item_id, unit_id, module, pool, section, current_hash, requires_audio, audio_job_ids, competency_ids, item_type').eq('module', 'core').not('unit_id', 'is', null).order('item_id').range(f, t)),
  ]);

  const names = new Map((compNames.data ?? []).map((c) => [c.competency_id, c.name as string]));
  const outdeg = prerequisiteOutdegree(Object.fromEntries((compNames.data ?? []).map((c) => [c.competency_id, c.prerequisites as string[]])));
  const activity = act.data ?? [];
  const byDate = new Map(activity.map((a) => [a.local_date as string, a]));
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(weekStart, i);
    return { date: d, label: weekdayShortRu(d), minutes: Math.round(((byDate.get(d)?.active_seconds as number) ?? 0) / 60) };
  });
  let streak = 0;
  for (let d = today; byDate.get(d) && ((byDate.get(d)!.attempts as number) > 0 || (byDate.get(d)!.active_seconds as number) > 60); d = addDays(d, -1)) streak++;

  const competencies = { ...EMPTY_STATES };
  for (const c of comps.data ?? []) competencies[c.state as MasteryState] += 1;
  const reviewRows = reviews.data ?? [];
  const due = reviewRows.filter((r) => r.due_local_date <= today);

  // ---- eligible released content ----
  const itemRows = items;
  const [rel, audio] = await Promise.all([
    releaseMap('item', itemRows.map((i) => ({ id: i.item_id, hash: i.current_hash })), viewer),
    playableAudio([...new Set(itemRows.flatMap((i) => i.audio_job_ids))], viewer),
  ]);
  const usable = itemRows.filter((i) => itemEligibility({ released: itemAccess(i, rel, audio).released, requiresAudio: i.requires_audio, audioVerified: itemAccess(i, rel, audio).audioReady, pool: i.pool, mode: 'tutoring', usedInSession: false, prerequisitesKnownUnmet: false }).eligible);
  const seenRes = await db.from('attempts').select('item_id, created_at').eq('user_id', userId).eq('preview', false).order('created_at', { ascending: false }).limit(5000);
  const lastSeen = new Map<string, string>();
  for (const s of seenRes.data ?? []) if (!lastSeen.has(s.item_id)) lastSeen.set(s.item_id, s.created_at);
  const pickFor = (cid: string, exclude: Set<string>) => orderItems(usable.filter((i) => i.competency_ids.includes(cid) && !exclude.has(i.item_id)).map((i) => ({ ...i, last_seen_at: lastSeen.get(i.item_id) ?? null })))[0] ?? null;

  // Weak = reliable meaning-changing errors in the last 14 days (half-open UTC window).
  const errCount = new Map<string, number>();
  for (const m of masteryRecent.data ?? []) {
    if (!m.reliable || m.meaning_changing === false) continue;
    if (!['independent_incorrect', 'review_failed', 'transfer_failed'].includes(m.event_type)) continue;
    if (!inUtcWindow(m.created_at, now.toISOString(), 14)) continue;
    errCount.set(m.competency_id, (errCount.get(m.competency_id) ?? 0) + 1);
  }
  const overdue = new Map<string, number>();
  for (const r of due) overdue.set(r.competency_id, Math.max(overdue.get(r.competency_id) ?? 0, diffDays(r.due_local_date, today)));
  const weak = rankWeak([...errCount.keys()].map((cid) => ({ competency_id: cid, reliable_errors_14d: errCount.get(cid)!, outdegree: outdeg[cid] ?? 0, overdue_days: overdue.get(cid) ?? 0, relevance: 0 })));
  const strongIds = (comps.data ?? []).filter((c) => ['recognition', 'controlled', 'spontaneous', 'retained', 'transfer_confirmed'].includes(c.state) && !errCount.has(c.competency_id)).map((c) => c.competency_id).sort();
  const weakItem = weak.map((w) => pickFor(w.competency_id, new Set())).find(Boolean) ?? null;
  const strongItem = strongIds.map((cid) => pickFor(cid, new Set())).find(Boolean) ?? null;
  const reviewItem = due.map((r) => pickFor(r.competency_id, new Set([r.anchor_item_id]))).find(Boolean) ?? null;

  const course = await loadCourse(userId, viewer);
  const nu = nextUnit(course);
  const applicationItem = orderItems(usable.filter((i) => ['writing', 'speaking', 'transfer'].includes(i.section ?? '') && course.units.find((u) => u.unit_id === i.unit_id)?.started).map((i) => ({ ...i, last_seen_at: lastSeen.get(i.item_id) ?? null })))[0] ?? null;

  const e = enr.data;
  const minutes = e?.daily_minutes ?? 60;
  const red = redistribute(splitBudget(minutes), { weak: !!weakItem, strong: !!strongItem, retention: !!reviewItem, new_content: !!nu, independent_application: !!applicationItem });
  const href = (i: { item_id: string } | null, ctx: string) => (i ? `/practice/${encodeURIComponent(i.item_id)}?context=${ctx}` : null);
  const blocks: PlanBlock[] = [
    { kind: 'new_content', title_ru: nu ? `Урок «${nu.title_ru}»` : 'Новый урок', minutes: red.budget.new_content, href: nu ? `/lesson/${nu.unit_id}` : null, detail_ru: nu ? `${nu.level} · ${nu.item_usable} из ${nu.item_total} заданий доступны` : 'Следующие уроки проходят проверку', available: !!nu },
    { kind: 'retention', title_ru: 'Отсроченное повторение', minutes: red.budget.retention, href: href(reviewItem, 'review'), detail_ru: due.length ? `${due.length} проверок D1–D28 на сегодня` : 'Сегодня отсроченных проверок нет', available: !!reviewItem },
    { kind: 'correction', title_ru: 'Работа над ошибками', minutes: red.budget.correction, href: href(weakItem ?? strongItem, 'corrective'), detail_ru: weak.length ? `80/20: ${red.budget.weak_correction} мин слабые темы, ${red.budget.strong_correction} мин поддержание` : 'Подтверждённых слабых тем пока нет', available: !!(weakItem || strongItem) },
    { kind: 'independent_application', title_ru: 'Самостоятельное применение', minutes: red.budget.independent_application, href: applicationItem ? href(applicationItem, 'writing') : '/speaking', detail_ru: applicationItem ? 'Письмо или устная задача по пройденному' : 'Разговорная практика по доступным сценариям', available: !!applicationItem },
  ];

  const startDate = (e?.start_date as LocalDate | null) ?? null;
  const prog = startDate ? planProgress(startDate, today) : null;
  return {
    generated_at: now.toISOString(),
    today,
    timezone,
    enrollment: e ? { start_date: startDate, end_date: startDate ? planEndDate(startDate) : null, exam_date: e.exam_date, daily_minutes: minutes, elapsed_days: prog?.elapsedDays ?? 0, total_days: prog?.totalDays ?? 0 } : null,
    stats: {
      active_days_streak: streak,
      lessons_completed: lessonsDone.count ?? 0,
      attempts_total: attemptsTotal.count ?? 0,
      minutes_7d: week.reduce((a, w) => a + w.minutes, 0),
      reliable_correct_7d: (masteryRecent.data ?? []).filter((m) => m.reliable && m.event_type === 'independent_correct' && m.created_at >= new Date(now.getTime() - 7 * 86_400_000).toISOString()).length,
    },
    week,
    competencies,
    mastered_competencies: competencies.retained + competencies.transfer_confirmed,
    reviews: { due_today: due.length, next_due: reviewRows[0]?.due_local_date ?? null, upcoming: reviewRows.slice(0, 6).map((r) => ({ competency_id: r.competency_id, interval_days: r.interval_days, due_local_date: r.due_local_date })) },
    errors: { open: (errs.data ?? []).length, recent: (errs.data ?? []).slice(0, 4).map((x) => ({ id: x.id, competency_id: x.competency_id, competency_name: x.competency_id ? names.get(x.competency_id) ?? null : null, created_at: x.created_at, error_kind: x.error_kind })) },
    pending_review: pending.count ?? 0,
    plan: { status: !startDate ? 'NOT_STARTED' : red.status, budget: red.budget, log: red.log, blocks },
    next_unit: nu ? { unit_id: nu.unit_id, title_ru: nu.title_ru, level: nu.level, item_usable: nu.item_usable, item_total: nu.item_total, estimated_active_minutes: nu.estimated_active_minutes, dev_preview: nu.dev_preview } : null,
    content: { units_released: course.units.filter((u) => u.released && !u.dev_preview).length, units_total: course.units.length, items_usable: usable.length, dev_preview_units: course.units.filter((u) => u.dev_preview).length },
    events: (events.data ?? []) as LearnerSnapshot['events'],
    route: { kind: course.routeKind, start_unit_id: course.startUnitId },
    level: levelPosition(course.units, nu),
    competencies_total: (compNames.data ?? []).length,
    lifecycle_state: profile.lifecycle_state,
    entry_path: profile.entry_path,
  };
}

const LEVEL_RU: Record<string, string> = { A0: 'Основы: алфавит и звуки', A1: 'Начальный', A2: 'Ниже среднего', B1: 'Средний', B2: 'Выше среднего' };

function levelPosition(units: UnitSummary[], next: UnitSummary | null): LearnerSnapshot['level'] {
  const inFoundations = !next ? false : FOUNDATION_UNITS.includes(next.unit_id);
  const code = (inFoundations ? 'A0' : (next?.level ?? [...units].reverse().find((u) => u.completed)?.level ?? 'A1')) as LearnerSnapshot['level']['code'];
  const pool = code === 'A0' ? units.filter((u) => FOUNDATION_UNITS.includes(u.unit_id)) : units.filter((u) => u.level === code && !FOUNDATION_UNITS.includes(u.unit_id));
  const completed = pool.filter((u) => u.completed).length;
  return { code, label_ru: LEVEL_RU[code], completed, total: pool.length, pct: pool.length ? Math.round((completed / pool.length) * 100) : 0 };
}
