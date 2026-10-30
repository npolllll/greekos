import 'server-only';
import { adminClient } from '../supabase/admin.ts';
import { HttpError, type SessionUser } from '../auth.ts';
import { loadItems, PUBLIC_VIEWER, type Viewer } from '../content/repo.ts';
import { deliverItems } from '../content/delivery.ts';
import { asrStatus } from '../providers/speech.ts';
import { submitAttempt, type AttemptResult } from '../learning/attempts.ts';
import { axisOf, levelOf, initialState, nextProbe, recordOutcome, skipAxis, axisResult, routeStart, type DiagState, type ProbeItem } from './engine.ts';
import type { ItemDTO } from '../content/dto.ts';

const SPOKEN_AXES = new Set(['spoken_interaction', 'spoken_production']);

async function probes(viewer: Viewer = PUBLIC_VIEWER): Promise<{ list: ProbeItem[]; dtos: Map<string, ItemDTO> }> {
  const { data } = await adminClient().from('items').select('item_id').eq('pool', 'diagnostic_holdout').order('item_id');
  const rows = await loadItems((data ?? []).map((d) => d.item_id));
  const delivered = await deliverItems(rows, { viewer });
  const voice = asrStatus().configured && !asrStatus().synthetic;
  const list: ProbeItem[] = [];
  const dtos = new Map<string, ItemDTO>();
  for (const d of delivered) {
    const axis = axisOf(d.dto.item_id);
    const level = levelOf(d.dto.item_id);
    if (!axis || !level) continue;
    const row = rows.find((r) => r.item_id === d.dto.item_id)!;
    dtos.set(d.dto.item_id, d.dto);
    list.push({
      item_id: d.dto.item_id, axis, level, usable: d.access.released,
      requires_audio: row.requires_audio && row.audio_job_ids.length > 0, audio_ready: d.access.audioReady,
      acoustic: axis === 'pronunciation', voice_required: SPOKEN_AXES.has(axis), voice_available: voice,
    });
  }
  return { list, dtos };
}

async function persist(sessionId: string, userId: string, state: DiagState) {
  const db = adminClient();
  await db.from('placement_sessions').update({ state }).eq('id', sessionId).eq('user_id', userId);
  for (const ax of state.axes) {
    const r = axisResult(ax);
    await db.from('placement_axis_results').upsert({
      session_id: sessionId, user_id: userId, axis: ax.axis, status: ax.status, observations: ax.observations,
      candidate_start: r.candidate_start, confidence: ax.status === 'OBSERVED' ? r.confidence : null,
      not_observed_reason: ax.not_observed_reason, updated_at: new Date().toISOString(),
    });
  }
}

export interface DiagView {
  session_id: string | null;
  status: 'NONE' | 'IN_PROGRESS' | 'COMPLETED';
  state: DiagState | null;
  current: ItemDTO | null;
  current_axis: string | null;
  voice_required: boolean;
  result: Record<string, unknown> | null;
}

export async function currentView(user: SessionUser): Promise<DiagView> {
  const db = adminClient();
  const { data: s } = await db.from('placement_sessions').select('id, status, state, result').eq('user_id', user.userId).order('started_at', { ascending: false }).limit(1).maybeSingle();
  if (!s) return { session_id: null, status: 'NONE', state: null, current: null, current_axis: null, voice_required: false, result: null };
  if (s.status !== 'IN_PROGRESS') return { session_id: s.id, status: 'COMPLETED', state: s.state as DiagState, current: null, current_axis: null, voice_required: false, result: s.result as Record<string, unknown> };
  const { list, dtos } = await probes(user);
  const { state, item } = nextProbe(s.state as DiagState, list);
  return { session_id: s.id, status: 'IN_PROGRESS', state, current: item ? dtos.get(item.item_id) ?? null : null, current_axis: item?.axis ?? null, voice_required: !!item?.voice_required, result: null };
}

export async function startDiagnostic(user: SessionUser) {
  const db = adminClient();
  const { data: open } = await db.from('placement_sessions').select('id').eq('user_id', user.userId).eq('status', 'IN_PROGRESS').maybeSingle();
  if (open) return currentView(user);
  const { data: proto } = await db.from('content_singletons').select('current_hash').eq('singleton_id', 'diagnostic_protocol').single();
  const { list } = await probes(user);
  const { state } = nextProbe(initialState(), list);
  const { data, error } = await db.from('placement_sessions').insert({ user_id: user.userId, entry_path: user.profile.entry_path ?? 'unsure', protocol_hash: proto!.current_hash, state }).select('id').single();
  if (error) throw error;
  await persist(data.id, user.userId, state);
  await db.from('profiles').update({ lifecycle_state: 'placement_in_progress' }).eq('user_id', user.userId).in('lifecycle_state', ['activated', 'placement_pending', 'provisional_route', 'foundations', 'studying']);
  return currentView(user);
}

export async function answerDiagnostic(user: SessionUser, body: { session_id: string; item_id: string; content_hash: string; response: { choice?: string; text?: string }; response_source: 'typed' | 'asr_confirmed'; idempotency_key: string }): Promise<{ attempt: AttemptResult; view: DiagView }> {
  const db = adminClient();
  const { data: s } = await db.from('placement_sessions').select('id, user_id, status, state').eq('id', body.session_id).maybeSingle();
  if (!s || s.user_id !== user.userId || s.status !== 'IN_PROGRESS') throw new HttpError(404, 'NOT_FOUND', 'Диагностика не найдена');
  const { list } = await probes(user);
  const { state, item } = nextProbe(s.state as DiagState, list);
  if (!item || item.item_id !== body.item_id) throw new HttpError(409, 'OUT_OF_ORDER', 'Это задание сейчас не активно. Обновите страницу.');
  if (item.voice_required && body.response_source !== 'asr_confirmed') throw new HttpError(422, 'VOICE_REQUIRED', 'Для этого навыка нужен устный ответ: письменный текст не измеряет говорение.');
  const attempt = await submitAttempt(user, { item_id: body.item_id, content_hash: body.content_hash, response: body.response, assistance: 'none', context: 'diagnostic', context_ref: s.id, response_source: body.response_source, idempotency_key: body.idempotency_key });
  if (!attempt.replayed) {
    const next = recordOutcome(state, { item_id: item.item_id, level: item.level, verdict: attempt.verdict, assisted: false });
    const advanced = nextProbe(next, list).state;
    await persist(s.id, user.userId, advanced);
    await db.from('learner_events').insert({ user_id: user.userId, event_type: 'placement_updated', idempotency_key: body.idempotency_key, payload: { axis: item.axis } });
  }
  return { attempt, view: await currentView(user) };
}

export async function skipCurrentAxis(user: SessionUser, sessionId: string) {
  const db = adminClient();
  const { data: s } = await db.from('placement_sessions').select('id, user_id, status, state').eq('id', sessionId).maybeSingle();
  if (!s || s.user_id !== user.userId || s.status !== 'IN_PROGRESS') throw new HttpError(404, 'NOT_FOUND', 'Диагностика не найдена');
  const { list } = await probes(user);
  const st = nextProbe(skipAxis(nextProbe(s.state as DiagState, list).state), list).state;
  await persist(s.id, user.userId, st);
  return currentView(user);
}

const LEVEL_FIRST_UNIT: Record<string, string> = { FOUNDATIONS: 'U-A1-007', A1: 'U-A1-001', A2: 'U-A2-001', B1: 'U-B1-001', B2: 'U-B2-001' };

export async function finishDiagnostic(user: SessionUser, sessionId: string) {
  const db = adminClient();
  const { data: s } = await db.from('placement_sessions').select('id, user_id, status, state').eq('id', sessionId).maybeSingle();
  if (!s || s.user_id !== user.userId) throw new HttpError(404, 'NOT_FOUND', 'Диагностика не найдена');
  if (s.status === 'COMPLETED') return currentView(user);
  const { list } = await probes(user);
  const st = nextProbe(s.state as DiagState, list).state;
  for (const ax of st.axes) if (ax.status === 'IN_PROGRESS') { ax.status = ax.observations.length ? 'OBSERVED' : 'STOPPED'; ax.not_observed_reason ??= ax.observations.length ? null : 'NOT_REACHED'; }
  const route = routeStart(st.axes);
  const result = {
    axes: st.axes.map((a) => ({ axis: a.axis, status: a.status, ...axisResult(a), reason: a.not_observed_reason })),
    route_level: route.level, route_basis: route.basis,
    disclaimer: '24 короткие пробы A1–B1 — предварительный профиль, не сертифицированный CEFR placement; B2 не измеряется.',
  };
  await persist(s.id, user.userId, st);
  await db.from('placement_sessions').update({ status: 'COMPLETED', completed_at: new Date().toISOString(), result }).eq('id', s.id);
  if (route.level) {
    const { data: prev } = await db.from('learning_routes').select('*').eq('user_id', user.userId).maybeSingle();
    const next = { user_id: user.userId, route_kind: route.level === 'FOUNDATIONS' ? 'foundations' : 'provisional', start_unit_id: LEVEL_FIRST_UNIT[route.level], skill_profile: result, reason: `Диагностика: старт ${route.level} по навыкам ${route.basis.join(', ')} (консервативно, предварительно)`, set_by: user.userId, set_at: new Date().toISOString() };
    await db.from('learning_routes').upsert(next);
    await db.from('route_changes').insert({ user_id: user.userId, previous: prev ?? null, next, reason: next.reason, changed_by: user.userId });
    await db.from('profiles').update({ lifecycle_state: route.level === 'FOUNDATIONS' ? 'foundations' : 'provisional_route' }).eq('user_id', user.userId);
  } else {
    await db.from('profiles').update({ lifecycle_state: 'placement_pending' }).eq('user_id', user.userId);
  }
  await db.from('learner_events').insert({ user_id: user.userId, event_type: 'placement_updated', idempotency_key: `finish-${s.id}`, payload: { route_level: route.level } });
  return currentView(user);
}
