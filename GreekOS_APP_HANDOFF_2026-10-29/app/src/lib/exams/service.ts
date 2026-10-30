import { randomUUID } from 'node:crypto';
import { adminClient, selectAll } from '../supabase/admin.ts';
import { HttpError, type SessionUser } from '../auth.ts';
import { deliverItems, type DeliveredItem } from '../content/delivery.ts';
import { loadTextObjects, playableAudio, signedAudioUrl, PUBLIC_VIEWER, type ItemRow, type Viewer } from '../content/repo.ts';
import { publicTextObject, type StimulusDTO } from '../content/dto.ts';
import { assessOpenResponse } from '../ai/assessor.ts';
import { llmConfigured } from '../providers/llm.ts';
import { localDateOf } from '../learning/calendar.ts';
import {
  autosaveDecision, componentDurationMinutes, componentKindOf, isExpired, sanitizeAnswers, EXPIRY_GRACE_MS,
  examPlayDecision, type ComponentKind, type ExamAnswers,
} from './core.ts';
import { scoreExamDeterministic, summarize, type ExamItemResult, type JointAdjudication } from './score.ts';

const ITEM_COLUMNS = 'item_id, module, unit_id, item_type, level, pool, section, requires_audio, scoring_strategy, competency_ids, prerequisite_ids, audio_job_ids, error_tags, envelope, current_hash';

export interface ComponentRow {
  component_id: string;
  form_id: string;
  logical_id: string | null;
  component_kind: ComponentKind;
  duration_minutes: number | null;
  item_ids: string[];
  text_ids: string[];
  payload: { form?: Record<string, unknown> } & Record<string, unknown>;
  current_hash: string;
}

export interface ComponentAvailability {
  reason: 'OK' | 'CONTENT_GATED' | 'AUDIO_PENDING' | 'SPEAKING' | 'NO_ITEMS';
  item_total: number;
  usable: number;
  gated: number;
  audio_pending: number;
  startable: boolean;
}

export function availabilityOf(kind: ComponentKind, delivered: DeliveredItem[], expected: number): ComponentAvailability {
  const usable = delivered.filter((d) => d.access.learnerUsable).length;
  const gated = delivered.filter((d) => !d.access.released).length;
  const audioPending = delivered.filter((d) => d.access.released && !d.access.audioReady).length;
  const missing = expected - delivered.length; // unsupported types fail closed
  let reason: ComponentAvailability['reason'] = 'OK';
  if (!expected) reason = 'NO_ITEMS';
  else if (kind === 'speaking') reason = 'SPEAKING';
  else if (kind === 'listening' && delivered.some((d) => d.dto.requires_audio && !d.access.audioReady)) reason = 'AUDIO_PENDING';
  else if (gated > 0 || missing > 0) reason = 'CONTENT_GATED';
  else if (audioPending > 0) reason = 'AUDIO_PENDING';
  return { reason, item_total: expected, usable, gated, audio_pending: audioPending, startable: reason === 'OK' && usable === expected };
}

export async function loadComponents(): Promise<ComponentRow[]> {
  const { data, error } = await adminClient().from('exam_components').select('component_id, form_id, logical_id, component_kind, duration_minutes, item_ids, text_ids, payload, current_hash').order('form_id').order('component_id');
  if (error) throw error;
  return (data ?? []) as ComponentRow[];
}

export async function loadComponent(componentId: string): Promise<ComponentRow | null> {
  const { data } = await adminClient().from('exam_components').select('component_id, form_id, logical_id, component_kind, duration_minutes, item_ids, text_ids, payload, current_hash').eq('component_id', componentId).maybeSingle();
  return (data as ComponentRow | null) ?? null;
}

export async function loadExamItems(itemIds: string[]): Promise<ItemRow[]> {
  if (!itemIds.length) return [];
  const rows = await selectAll<ItemRow>((f, t) => adminClient().from('items').select(ITEM_COLUMNS).eq('module', 'keg_b2').order('item_id').range(f, t));
  const order = new Map(itemIds.map((id, i) => [id, i]));
  return rows.filter((r) => order.has(r.item_id)).sort((a, b) => order.get(a.item_id)! - order.get(b.item_id)!);
}

/** Candidate view of one component: DTOs (exam mode, no criteria), shared texts, availability. */
export async function candidateComponent(c: ComponentRow, viewer: Viewer = PUBLIC_VIEWER) {
  const rows = await loadExamItems(c.item_ids);
  const delivered = await deliverItems(rows, { examMode: true, viewer });
  const textObjs = await loadTextObjects(c.text_ids ?? []);
  const texts: Array<StimulusDTO & { text_id: string }> = [];
  for (const id of c.text_ids ?? []) {
    const pub = publicTextObject(textObjs.get(id));
    if (pub) texts.push({ kind: 'text', text_id: id, ...pub });
  }
  const kind = (c.component_kind ?? componentKindOf(c.component_id)) as ComponentKind;
  const form = (c.payload?.form ?? {}) as Record<string, unknown>;
  const comparison = form.comparison as { columns?: unknown } | undefined;
  const columns = Array.isArray(comparison?.columns) ? (comparison!.columns as unknown[]).filter((x): x is string => typeof x === 'string') : [];
  return {
    kind,
    rows,
    delivered,
    texts,
    columns,
    duration: componentDurationMinutes(c.duration_minutes, form),
    availability: availabilityOf(kind, delivered, c.item_ids.length),
  };
}

export async function jointAdjudication(): Promise<JointAdjudication | null> {
  const { data } = await adminClient().from('content_singletons').select('payload').eq('singleton_id', 'u01_joint_adjudication').maybeSingle();
  const p = (data?.payload as { payload?: JointAdjudication } | undefined)?.payload;
  return p && Array.isArray(p.canonical_solution) ? p : null;
}

export interface ExamAttemptRow {
  id: string;
  user_id: string;
  component_id: string;
  component_hash: string;
  mode: 'simulation' | 'practice';
  status: 'IN_PROGRESS' | 'SUBMITTED' | 'EXPIRED' | 'ABANDONED';
  server_started_at: string;
  server_expires_at: string | null;
  answers_private: ExamAnswers;
  autosave_seq: number;
  submitted_at: string | null;
  results: StoredResults | null;
  idempotency_key: string;
  audio_plays?: Record<string, number>;
}

export interface StoredResults {
  provisional: true;
  scored_at: string;
  summary: ReturnType<typeof summarize>;
  items: Array<ExamItemResult & { key: string[]; model_response: string | null; ai: { confidence: string | null; dimensions: unknown[]; errors: unknown[] } | null }>;
  disclaimer: string;
}

const ATTEMPT_COLUMNS = 'id, user_id, component_id, component_hash, mode, status, server_started_at, server_expires_at, answers_private, autosave_seq, submitted_at, results, idempotency_key, audio_plays';

export async function getOwnAttempt(user: SessionUser, attemptId: string): Promise<ExamAttemptRow> {
  const { data } = await adminClient().from('exam_attempts').select(ATTEMPT_COLUMNS).eq('id', attemptId).maybeSingle();
  if (!data || data.user_id !== user.userId) throw new HttpError(404, 'NOT_FOUND', 'Попытка не найдена');
  return data as ExamAttemptRow;
}

/** Lazily marks an overdue in-progress attempt EXPIRED (server time is authoritative). */
async function expireIfNeeded(a: ExamAttemptRow): Promise<ExamAttemptRow> {
  if (a.status === 'IN_PROGRESS' && isExpired(a.server_expires_at)) {
    await adminClient().from('exam_attempts').update({ status: 'EXPIRED' }).eq('id', a.id).eq('status', 'IN_PROGRESS');
    return { ...a, status: 'EXPIRED' };
  }
  return a;
}

export function publicState(a: ExamAttemptRow) {
  return {
    attempt_id: a.id,
    component_id: a.component_id,
    mode: a.mode,
    status: a.status,
    server_now: new Date().toISOString(),
    started_at: a.server_started_at,
    expires_at: a.server_expires_at,
    autosave_seq: a.autosave_seq,
    answers: a.answers_private ?? {},
    audio_plays: a.audio_plays ?? {},
    submitted_at: a.submitted_at,
    results: a.status === 'SUBMITTED' ? a.results : null,
  };
}

export async function attemptState(user: SessionUser, attemptId: string) {
  return publicState(await expireIfNeeded(await getOwnAttempt(user, attemptId)));
}

export async function startAttempt(user: SessionUser, input: { component_id: string; mode: 'simulation' | 'practice'; idempotency_key: string }) {
  const db = adminClient();
  const replay = await db.from('exam_attempts').select(ATTEMPT_COLUMNS).eq('user_id', user.userId).eq('idempotency_key', input.idempotency_key).maybeSingle();
  if (replay.data) return publicState(await expireIfNeeded(replay.data as ExamAttemptRow));

  const c = await loadComponent(input.component_id);
  if (!c) throw new HttpError(404, 'NOT_FOUND', 'Компонент не найден');
  const view = await candidateComponent(c, user);
  if (!view.availability.startable) throw new HttpError(403, view.availability.reason, view.availability.reason === 'AUDIO_PENDING' ? 'Нет проверенного аудио — аудирование не проводится.' : view.availability.reason === 'SPEAKING' ? 'Говорение проходит в разделе «Разговоры».' : 'Задания компонента ещё проходят проверку.');

  const { data: open } = await db.from('exam_attempts').select(ATTEMPT_COLUMNS).eq('user_id', user.userId).eq('component_id', c.component_id).eq('status', 'IN_PROGRESS').order('server_started_at', { ascending: false }).limit(1).maybeSingle();
  if (open) {
    const cur = await expireIfNeeded(open as ExamAttemptRow);
    if (cur.status === 'IN_PROGRESS') return publicState(cur);
  }
  if (input.mode === 'simulation' && !view.duration.minutes) throw new HttpError(409, 'NO_DECLARED_TIME', 'Для компонента не задано время — доступен только режим практики без таймера.');

  const now = new Date();
  const expires = input.mode === 'simulation' ? new Date(now.getTime() + view.duration.minutes! * 60_000).toISOString() : null;
  const { data, error } = await db.from('exam_attempts').insert({
    user_id: user.userId, component_id: c.component_id, component_hash: c.current_hash, mode: input.mode,
    server_started_at: now.toISOString(), server_expires_at: expires, idempotency_key: input.idempotency_key,
  }).select(ATTEMPT_COLUMNS).single();
  if (error) {
    const again = await db.from('exam_attempts').select(ATTEMPT_COLUMNS).eq('user_id', user.userId).eq('idempotency_key', input.idempotency_key).maybeSingle();
    if (again.data) return publicState(again.data as ExamAttemptRow);
    throw new Error(error.message);
  }
  await db.rpc('commit_learning_event', {
    p: {
      user_id: user.userId, idempotency_key: `exam-start-${data.id}`, scope: 'exam',
      events: [{ event_type: 'exam_started', idempotency_key: `exam-start-${data.id}`, payload: { component_id: c.component_id, mode: input.mode } }],
      result: { ok: true },
    },
  });
  return publicState(data as ExamAttemptRow);
}

export async function autosave(user: SessionUser, input: { attempt_id: string; seq: number; answers: unknown }) {
  const a = await expireIfNeeded(await getOwnAttempt(user, input.attempt_id));
  const c = await loadComponent(a.component_id);
  if (!c) throw new HttpError(404, 'NOT_FOUND', 'Компонент не найден');
  const d = autosaveDecision(a, input.seq);
  if (!d.ok) {
    const msg = { SUBMITTED: 'Попытка уже сдана.', EXPIRED: 'Время вышло — ответы зафиксированы по последнему автосохранению.', STALE: 'Получено устаревшее сохранение.', ABANDONED: 'Попытка прервана.' }[d.code];
    throw Object.assign(new HttpError(409, d.code, msg), { state: publicState(a) });
  }
  const answers = sanitizeAnswers(input.answers, c.item_ids);
  const { data, error } = await adminClient().from('exam_attempts')
    .update({ answers_private: answers, autosave_seq: input.seq })
    .eq('id', a.id).eq('status', 'IN_PROGRESS').lt('autosave_seq', input.seq)
    .select('autosave_seq').maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new HttpError(409, 'STALE', 'Получено устаревшее сохранение.');
  return { ok: true, autosave_seq: data.autosave_seq, saved_at: new Date().toISOString(), server_now: new Date().toISOString(), expires_at: a.server_expires_at };
}

async function rubricPayload(rubric: unknown): Promise<unknown> {
  if (typeof rubric === 'string') {
    const { data } = await adminClient().from('rubrics').select('payload').eq('rubric_id', rubric).maybeSingle();
    return data?.payload ?? null;
  }
  return rubric ?? null;
}

/**
 * Submit is idempotent: a submitted attempt returns its stored results. Expired attempts are
 * scored from the last autosave; final answers are accepted only within the grace window.
 */
export async function submit(user: SessionUser, input: { attempt_id: string; seq?: number; answers?: unknown }) {
  const db = adminClient();
  let a = await getOwnAttempt(user, input.attempt_id);
  if (a.status === 'SUBMITTED' && a.results) return publicState(a);
  if (a.status === 'ABANDONED') throw new HttpError(409, 'ABANDONED', 'Попытка прервана.');
  const c = await loadComponent(a.component_id);
  if (!c) throw new HttpError(404, 'NOT_FOUND', 'Компонент не найден');

  let answers = (a.answers_private ?? {}) as ExamAnswers;
  if (a.status === 'IN_PROGRESS' && input.answers !== undefined && !isExpired(a.server_expires_at)) {
    answers = sanitizeAnswers(input.answers, c.item_ids);
  }
  if (a.status !== 'SUBMITTED') {
    const { data: claimed } = await db.from('exam_attempts')
      .update({ status: 'SUBMITTED', submitted_at: new Date().toISOString(), answers_private: answers, autosave_seq: Math.max(a.autosave_seq, input.seq ?? 0) })
      .eq('id', a.id).in('status', ['IN_PROGRESS', 'EXPIRED']).select('id').maybeSingle();
    if (!claimed) {
      a = await getOwnAttempt(user, input.attempt_id);
      if (a.results) return publicState(a);
      answers = (a.answers_private ?? {}) as ExamAnswers;
    }
  }

  const rows = await loadExamItems(c.item_ids);
  const envelopes = rows.map((r) => r.envelope);
  const results = scoreExamDeterministic(envelopes, answers, await jointAdjudication());
  const aiDetails = new Map<string, { confidence: string | null; dimensions: unknown[]; errors: unknown[] }>();
  if (llmConfigured()) {
    for (const r of results) {
      if (!r.needs_ai || !r.response?.text) continue;
      const row = rows.find((x) => x.item_id === r.item_id)!;
      const ai = await assessOpenResponse({ userId: user.userId, item: row.envelope, rubricPayload: await rubricPayload(row.envelope.rubric), learnerText: r.response.text, source: 'typed' });
      if (ai.verdict !== 'ABSTAIN' && ai.verdict !== 'PENDING_REVIEW') {
        Object.assign(r, { verdict: ai.verdict, reliable: ai.reliable, scorer: 'ai_assessor', meaning_changing: ai.meaningChanging, uncertainty: ai.uncertainty, feedback_ru: ai.feedbackRu, evidence: ai.evidence });
        aiDetails.set(r.item_id, { confidence: ai.confidence, dimensions: ai.dimensions, errors: ai.errors });
      } else {
        Object.assign(r, { verdict: ai.verdict === 'ABSTAIN' ? 'ABSTAIN' : 'PENDING_REVIEW', uncertainty: ai.uncertainty, feedback_ru: ai.feedbackRu });
      }
    }
  }

  // Persist each answered item as an exam attempt + assessment (no mastery events: exam evidence stays separate).
  const now = new Date();
  const localDate = localDateOf(now, user.profile.timezone);
  for (const r of results) {
    if (!r.answered) continue;
    const row = rows.find((x) => x.item_id === r.item_id)!;
    const attemptId = randomUUID();
    const key = `${a.id}:${r.item_id}`;
    const { error } = await db.rpc('commit_learning_event', {
      p: {
        user_id: user.userId, idempotency_key: key, scope: 'exam_item',
        attempt: {
          attempt_id: attemptId, user_id: user.userId, item_id: r.item_id, content_hash: row.current_hash, context: 'exam', context_ref: a.id,
          response_private: { ...(r.response ?? {}), source: 'typed' }, assistance: 'none', released_snapshot: true, preview: false,
          idempotency_key: key, local_date: localDate, timezone: user.profile.timezone, active_ms: null, created_at: now.toISOString(),
        },
        assessment: {
          assessment_id: randomUUID(), attempt_id: attemptId, user_id: user.userId, verdict: r.verdict, scorer: r.scorer, reliable: r.reliable,
          meaning_changing: r.meaning_changing, error_kind: r.error_kind, error_tags: row.error_tags,
          rubric_id: typeof row.envelope.rubric === 'string' ? row.envelope.rubric : null, rubric_hash: null,
          assessor_version: r.scorer === 'ai_assessor' ? 'greekos-assessor/1.0:exam' : r.scorer === 'joint_bank' ? 'u01-joint-adjudication/1.0' : 'deterministic-key/1.0',
          dimensions: aiDetails.get(r.item_id)?.dimensions ?? null, evidence: r.evidence, uncertainty: r.uncertainty, feedback_ru: r.feedback_ru,
          status: 'ACTIVE', supersedes_id: null, created_at: now.toISOString(),
        },
        result: { verdict: r.verdict },
      },
    });
    if (error) throw new Error(`exam commit failed: ${error.message}`);
  }

  const summary = summarize(results);
  const stored: StoredResults = {
    provisional: true,
    scored_at: now.toISOString(),
    summary,
    disclaimer: 'Предварительный некалиброванный результат, не официальный балл.',
    items: results.map((r) => {
      const env = rows.find((x) => x.item_id === r.item_id)!.envelope;
      return {
        ...r,
        key: [...(env.answer ?? []), ...(env.accepted_alternatives ?? [])].filter((x): x is string => typeof x === 'string').slice(0, 8),
        model_response: typeof env.model_response === 'string' ? env.model_response : null,
        ai: aiDetails.get(r.item_id) ?? null,
      };
    }),
  };
  await db.from('exam_attempts').update({ results: stored }).eq('id', a.id).eq('user_id', user.userId);
  await db.rpc('commit_learning_event', {
    p: {
      user_id: user.userId, idempotency_key: `exam-done-${a.id}`, scope: 'exam',
      events: [{ event_type: 'exam_completed', idempotency_key: `exam-done-${a.id}`, payload: { component_id: c.component_id, answered: summary.answered, keyed_correct_reliable: summary.keyed_correct_reliable, keyed_total: summary.keyed_total, held_for_review: summary.held_for_review } }],
      result: { ok: true },
    },
  });
  return publicState({ ...(await getOwnAttempt(user, a.id)) });
}

/** Owner-only QA preview: deterministic scoring without persistence or AI calls. */
export async function previewScore(componentId: string, answers: unknown) {
  const c = await loadComponent(componentId);
  if (!c) throw new HttpError(404, 'NOT_FOUND', 'Компонент не найден');
  const rows = await loadExamItems(c.item_ids);
  const clean = sanitizeAnswers(answers, c.item_ids);
  const results = scoreExamDeterministic(rows.map((r) => r.envelope), clean, await jointAdjudication());
  return {
    preview: true,
    summary: summarize(results),
    items: results.map((r) => {
      const env = rows.find((x) => x.item_id === r.item_id)!.envelope;
      return { item_id: r.item_id, verdict: r.verdict, reliable: r.reliable, feedback_ru: r.feedback_ru, key: [...(env.answer ?? []), ...(env.accepted_alternatives ?? [])].filter((x): x is string => typeof x === 'string').slice(0, 8) };
    }),
  };
}

export const GRACE_MS = EXPIRY_GRACE_MS;

export interface OverviewComponent {
  component_id: string;
  display_id: string;
  form_id: string;
  kind: ComponentKind;
  duration_minutes: number | null;
  availability: ComponentAvailability;
  last: { id: string; status: string; mode: string; submitted_at: string | null; summary: StoredResults['summary'] | null } | null;
  open_attempt_id: string | null;
}

/** All three forms with their five components and the learner's own attempt status. */
export async function examOverview(userId: string, viewer: Viewer = PUBLIC_VIEWER) {
  const db = adminClient();
  const [components, { data: forms }, rows, { data: attempts }] = await Promise.all([
    loadComponents(),
    db.from('exam_forms').select('form_id, payload').order('form_id'),
    selectAll<ItemRow>((f, t) => db.from('items').select(ITEM_COLUMNS).eq('module', 'keg_b2').order('item_id').range(f, t)),
    db.from('exam_attempts').select('id, component_id, status, mode, submitted_at, server_started_at, results').eq('user_id', userId).order('server_started_at', { ascending: false }).limit(200),
  ]);
  const delivered = await deliverItems(rows, { examMode: true, viewer });
  const byId = new Map(delivered.map((d) => [d.dto.item_id, d]));
  const out = (forms ?? []).map((f) => {
    const assembly = ((f.payload as { assembly?: Record<string, unknown> }).assembly ?? {}) as Record<string, unknown>;
    const comps: OverviewComponent[] = components.filter((c) => c.form_id === f.form_id).map((c) => {
      const kind = (c.component_kind ?? componentKindOf(c.component_id)) as ComponentKind;
      const ds = c.item_ids.map((id) => byId.get(id)).filter((x): x is DeliveredItem => !!x);
      const mine = (attempts ?? []).filter((a) => a.component_id === c.component_id);
      const last = mine.find((a) => a.status === 'SUBMITTED') ?? mine[0] ?? null;
      return {
        component_id: c.component_id,
        display_id: c.logical_id && c.logical_id !== c.component_id ? c.logical_id : c.component_id,
        form_id: c.form_id,
        kind,
        duration_minutes: componentDurationMinutes(c.duration_minutes, (c.payload?.form ?? {}) as Record<string, unknown>).minutes,
        availability: availabilityOf(kind, ds, c.item_ids.length),
        last: last ? { id: last.id, status: last.status, mode: last.mode, submitted_at: last.submitted_at, summary: (last.results as StoredResults | null)?.summary ?? null } : null,
        open_attempt_id: mine.find((a) => a.status === 'IN_PROGRESS')?.id ?? null,
      };
    });
    const ORDER: ComponentKind[] = ['reading', 'use_of_language', 'listening', 'writing', 'speaking'];
    comps.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
    return {
      form_id: f.form_id,
      status: typeof assembly.status === 'string' ? assembly.status : null,
      text_assembly_complete: assembly.text_assembly_complete === true,
      components: comps,
    };
  });
  return out;
}

/**
 * One exam listening play: only for the candidate's own in-progress attempt, only for a released,
 * digitally verified asset of this component's items, within the play limit (counted server-side
 * with optimistic concurrency so parallel tabs cannot exceed it). Returns a 60 s signed URL.
 */
export async function examAudioPlay(user: SessionUser, attemptId: string, assetId: string) {
  const db = adminClient();
  for (let tries = 0; tries < 3; tries++) {
    const a = await expireIfNeeded(await getOwnAttempt(user, attemptId));
    if (a.status !== 'IN_PROGRESS') throw new HttpError(409, 'ATTEMPT_CLOSED', 'Попытка уже завершена.');
    const c = await loadComponent(a.component_id);
    const rows = await loadExamItems(c?.item_ids ?? []);
    const playable = await playableAudio([...new Set(rows.flatMap((r) => r.audio_job_ids))], user);
    const asset = [...playable.values()].find((p) => p.asset_id === assetId);
    if (!asset) throw new HttpError(403, 'AUDIO_PENDING', 'Аудио этого задания пока недоступно.');
    const plays = a.audio_plays ?? {};
    const d = examPlayDecision(a.mode, plays, assetId);
    if (!d.allowed) throw new HttpError(409, 'NO_MORE_PLAYS', `Запись уже прослушана ${d.used} раза — по правилам формы больше нельзя.`);
    const next = { ...plays, [assetId]: d.used + 1 };
    const { data: upd } = await db.from('exam_attempts').update({ audio_plays: next }).eq('id', a.id).eq('status', 'IN_PROGRESS').eq('audio_plays', JSON.stringify(plays)).select('id');
    if (!upd?.length) continue; // concurrent play in another tab: re-read and re-check
    const url = await signedAudioUrl(asset.object_path, 'course-audio', 60);
    if (!url) throw new HttpError(404, 'NOT_FOUND', 'Файл недоступен');
    return { url, plays_used: d.used + 1, plays_remaining: d.remaining === null ? null : d.remaining - 1, expires_in: 60 };
  }
  throw new HttpError(409, 'CONFLICT', 'Повторите попытку.');
}
