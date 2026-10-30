import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { adminClient } from '../supabase/admin.ts';
import { HttpError, type SessionUser } from '../session-user.ts';
import { releaseMap } from '../content/repo.ts';
import { env } from '../env.ts';
import { llmConfigured, structuredCall } from '../providers/llm.ts';
import { asrStatus, synthesizeWithVoice, type SpeedProfile } from '../providers/speech.ts';
import type { CatalogVoice } from '../voice/catalog.ts';
import { localDateOf } from '../learning/calendar.ts';
import { refreshCompetencyState } from '../learning/state.ts';
import { nextTurn, nodeById, isTerminal, summarizeSession, type ScenarioPayload } from './dialogue.ts';
import { HINTS_ALLOWED, type SpeakingMode } from './state-machine.ts';

export interface TurnView {
  turn_id: string;
  seq: number;
  speaker: 'learner' | 'assistant';
  text: string;
  node_id: string | null;
  confirmed: boolean;
  interrupted: boolean;
  generated: boolean;
  help: string[];
  source: string | null;
}

export interface SessionView {
  session_id: string;
  scenario_id: string;
  title: string;
  level: string | null;
  mode: SpeakingMode;
  input_mode: 'voice' | 'text_fallback';
  status: string;
  current_node: string | null;
  goal_ru: string | null;
  ended_node: boolean;
  turns: TurnView[];
  summary: Record<string, unknown> | null;
  preview: boolean;
  providers: { llm: boolean; asr: string | null; tts: string | null; synthetic: boolean };
  hints_allowed: boolean;
  unscored: boolean;
  persona: { cast_role_id: string | null; voice_id: string | null; voice_name: string | null; presentation: string | null; engine: string | null; dev_only: boolean };
  transport: 'batch' | 'stream_local_gateway' | 'stream_cloud_gateway';
}

/** Voice for a session persona: the cast role's assigned, available voice (declared presentation). */
export async function personaVoice(castRoleId: string | null): Promise<CatalogVoice | null> {
  if (!castRoleId) return null;
  const db = adminClient();
  const { data: role } = await db.from('cast_roles').select('voice_id, approved').eq('cast_role_id', castRoleId).maybeSingle();
  if (!role?.voice_id) return null;
  // Outside local development a persona speaks only with an owner-approved cast.
  if (!role.approved && !env.localEnginesAllowed) return null;
  const { data: v } = await db.from('voice_catalog').select('*').eq('voice_id', role.voice_id).maybeSingle();
  if (!v || !v.available || v.provider === 'mock') return null;
  if (v.engine_kind === 'local' && !env.localEnginesAllowed) return null;
  return v as CatalogVoice;
}

/** Personas the learner can choose; a persona without an available voice is listed as unavailable. */
export async function personaOptions() {
  const out = [];
  for (const id of ['TUTOR_F', 'TUTOR_M']) {
    const v = await personaVoice(id);
    out.push({ cast_role_id: id, presentation: id.endsWith('_F') ? 'female' : 'male', voice_name: v?.display_name ?? null, available: !!v, dev_only: v ? !v.distribution_allowed : false });
  }
  return out;
}

async function scenarioFor(id: string, user: SessionUser) {
  const { data } = await adminClient().from('speaking_scenarios').select('scenario_id, level, domain, objective_ru, competency_ids, payload, current_hash').eq('scenario_id', id).maybeSingle();
  if (!data) throw new HttpError(404, 'NOT_FOUND', 'Сценарий не найден');
  // DEV-PREVIEW: an owner-granted test account runs gated scenarios as real (labelled) sessions.
  const released = (await releaseMap('scenario', [{ id: data.scenario_id, hash: data.current_hash }], user)).has(data.scenario_id);
  if (!released && !user.isOwner) throw new HttpError(403, 'CONTENT_GATED', 'Сценарий проходит проверку');
  return { row: data, payload: data.payload as ScenarioPayload & { module?: string; unscored?: boolean }, preview: !released };
}

function providers(voice?: CatalogVoice | null) {
  const a = asrStatus();
  return { llm: llmConfigured(), asr: a.configured ? a.provider : null, tts: voice ? voice.provider : null, synthetic: a.synthetic };
}

export async function sessionView(user: SessionUser, sessionId: string): Promise<SessionView> {
  const db = adminClient();
  const { data: s } = await db.from('speaking_sessions').select('*').eq('session_id', sessionId).maybeSingle();
  if (!s || s.user_id !== user.userId) throw new HttpError(404, 'NOT_FOUND', 'Разговор не найден');
  const { data: sc } = await db.from('speaking_scenarios').select('scenario_id, level, domain, objective_ru, payload').eq('scenario_id', s.scenario_id).single();
  const payload = sc!.payload as ScenarioPayload & { unscored?: boolean };
  const { data: turns } = await db.from('speaking_turns').select('turn_id, seq, speaker, text_el, asr_text, node_id, transcript_confirmed, interrupted, help_used, intent').eq('session_id', sessionId).order('seq');
  const node = nodeById(payload, s.current_node ?? payload.entry_node);
  const voice = await personaVoice(s.voice_persona);
  return {
    session_id: s.session_id, scenario_id: s.scenario_id, title: `${sc!.domain ?? ''}`, level: sc!.level, mode: s.mode, input_mode: s.input_mode,
    status: s.status, current_node: s.current_node, goal_ru: node?.learner_goal_ru ?? sc!.objective_ru, ended_node: isTerminal(node),
    turns: (turns ?? []).map((t) => ({
      turn_id: t.turn_id, seq: t.seq, speaker: t.speaker, text: t.text_el ?? t.asr_text ?? '', node_id: t.node_id, confirmed: t.transcript_confirmed,
      interrupted: t.interrupted, generated: t.intent === 'generated', help: (t.help_used as string[]) ?? [], source: t.speaker === 'learner' ? t.intent : null,
    })),
    summary: (s.summary_private as Record<string, unknown>) ?? null,
    preview: s.preview,
    providers: providers(voice),
    hints_allowed: HINTS_ALLOWED(s.mode),
    unscored: !!payload.unscored,
    persona: { cast_role_id: s.voice_persona, voice_id: voice?.voice_id ?? null, voice_name: voice?.display_name ?? null, presentation: voice?.presentation ?? null, engine: voice?.engine_kind ?? null, dev_only: voice ? !voice.distribution_allowed : false },
    transport: s.transport,
  };
}

export async function startSession(user: SessionUser, b: { scenario_id: string; mode: SpeakingMode; input_mode: 'voice' | 'text_fallback'; idempotency_key: string; voice_persona?: 'TUTOR_F' | 'TUTOR_M' | null; transport?: 'batch' | 'stream_local_gateway' }) {
  const db = adminClient();
  const { row, payload, preview } = await scenarioFor(b.scenario_id, user);
  if (b.mode === 'b2_mock' && row.level !== 'B2') throw new HttpError(422, 'MODE_LEVEL', 'Экзаменационный режим доступен только для сценариев B2.');
  if (b.mode === 'real_greek' && payload.module !== 'real_greek') throw new HttpError(422, 'MODE_SCENARIO', 'Режим «Живой греческий» использует отдельные сценарии Real Greek.');
  if (b.input_mode === 'voice' && !(asrStatus().configured)) throw new HttpError(503, 'VOICE_UNAVAILABLE', 'Распознавание речи не подключено. Доступен только текстовый режим (не засчитывается как говорение).');
  const existing = await db.from('speaking_turns').select('session_id').eq('user_id', user.userId).eq('idempotency_key', `${b.idempotency_key}:open`).maybeSingle();
  if (existing.data) return sessionView(user, existing.data.session_id);
  const entry = nodeById(payload, payload.entry_node);
  const { data: s, error } = await db.from('speaking_sessions').insert({
    user_id: user.userId, scenario_id: row.scenario_id, scenario_hash: row.current_hash, mode: b.mode, input_mode: b.input_mode,
    current_node: payload.entry_node, provider_snapshot: providers(await personaVoice(b.voice_persona ?? null)), preview, local_date: localDateOf(new Date(), user.profile.timezone),
    voice_persona: b.voice_persona ?? null, transport: b.input_mode === 'voice' && b.transport === 'stream_local_gateway' ? 'stream_local_gateway' : 'batch',
  }).select('session_id').single();
  if (error) throw error;
  await db.from('speaking_turns').insert({ session_id: s.session_id, user_id: user.userId, seq: 0, speaker: 'assistant', node_id: payload.entry_node, text_el: entry?.assistant_el ?? '', transcript_confirmed: true, idempotency_key: `${b.idempotency_key}:open`, intent: 'authored' });
  return sessionView(user, s.session_id);
}

export type LearnerSource = 'asr_confirmed' | 'asr_auto' | 'learner_corrected' | 'typed';

export async function learnerTurn(user: SessionUser, b: { session_id: string; text: string; source: LearnerSource; asr_confidence: number | null; help_used: string[]; repair: boolean; interrupted_previous: boolean; idempotency_key: string }) {
  const db = adminClient();
  const { data: s } = await db.from('speaking_sessions').select('*').eq('session_id', b.session_id).maybeSingle();
  if (!s || s.user_id !== user.userId) throw new HttpError(404, 'NOT_FOUND', 'Разговор не найден');
  if (s.status !== 'ACTIVE') throw new HttpError(409, 'SESSION_CLOSED', 'Разговор уже завершён');
  if (s.input_mode === 'voice' && b.source === 'typed' && !b.repair) throw new HttpError(422, 'VOICE_SESSION', 'В голосовом режиме ответ отправляется голосом.');
  const replay = await db.from('speaking_turns').select('turn_id').eq('user_id', user.userId).eq('idempotency_key', `${b.idempotency_key}:a`).maybeSingle();
  if (replay.data) return sessionView(user, b.session_id);

  const { data: sc } = await db.from('speaking_scenarios').select('payload').eq('scenario_id', s.scenario_id).single();
  const payload = sc!.payload as ScenarioPayload;
  const { data: prior } = await db.from('speaking_turns').select('turn_id, seq, speaker, text_el, asr_text, transcript_confirmed, interrupted, heard_text').eq('session_id', s.session_id).order('seq');
  const seq = (prior?.at(-1)?.seq ?? 0) + 1;
  if (b.interrupted_previous) {
    const lastA = [...(prior ?? [])].reverse().find((t) => t.speaker === 'assistant');
    if (lastA) await db.from('speaking_turns').update({ interrupted: true, playback_completed: false }).eq('turn_id', lastA.turn_id);
  }
  const text = b.text.trim().slice(0, 1200);
  if (!b.repair) {
    if (!text) throw new HttpError(422, 'EMPTY_TURN', 'Пустая реплика не отправляется.');
    const ins = await db.from('speaking_turns').insert({
      session_id: s.session_id, user_id: user.userId, seq, speaker: 'learner', node_id: s.current_node, text_el: text,
      asr_text: b.source === 'typed' ? null : text, asr_confidence: b.asr_confidence, asr_provider: b.source === 'typed' ? null : (s.provider_snapshot as { asr?: string }).asr ?? null,
      transcript_confirmed: b.source !== 'typed', help_used: b.help_used, idempotency_key: `${b.idempotency_key}:l`, intent: b.source,
    });
    if (ins.error && ins.error.code !== '23505') throw ins.error;
  }
  const decision = await nextTurn({
    userId: user.userId, scenario: payload, mode: s.mode, currentNode: s.current_node ?? payload.entry_node,
    // Only what the learner actually heard counts as context: interrupted AI turns are truncated.
    history: (prior ?? []).map((t) => ({ role: t.speaker === 'learner' ? 'learner' : 'assistant', text: t.speaker === 'assistant' && t.interrupted ? t.heard_text ?? '' : t.text_el ?? t.asr_text ?? '' })),
    learnerText: b.repair ? '' : text, repairRequested: b.repair, repairLoops: s.repair_loops,
  });
  await db.from('speaking_turns').insert({
    session_id: s.session_id, user_id: user.userId, seq: b.repair ? seq : seq + 1, speaker: 'assistant', node_id: decision.nextNode, text_el: decision.assistantEl,
    transcript_confirmed: true, idempotency_key: `${b.idempotency_key}:a`, intent: decision.generated ? 'generated' : 'authored',
    help_used: decision.hintRu ? [`hint:${decision.hintRu}`] : [],
  });
  await db.from('speaking_sessions').update({ current_node: decision.nextNode, repair_loops: decision.repairLoops }).eq('session_id', s.session_id);
  return { ...(await sessionView(user, s.session_id)), engine: decision.engine, hint_ru: decision.hintRu, intent: decision.intent };
}

const HelpOut = z.object({ answer_ru: z.string(), example_el: z.string().nullable() });

/** On-demand tutor help; the dialogue state is not touched, so the learner returns to the same scene. */
export async function help(user: SessionUser, b: { session_id: string; kind: 'hint' | 'translate' | 'explain' | 'how_to_say'; question?: string }) {
  const db = adminClient();
  const { data: s } = await db.from('speaking_sessions').select('session_id, user_id, scenario_id, current_node, mode').eq('session_id', b.session_id).maybeSingle();
  if (!s || s.user_id !== user.userId) throw new HttpError(404, 'NOT_FOUND', 'Разговор не найден');
  if (!HINTS_ALLOWED(s.mode)) throw new HttpError(403, 'NO_HINTS', 'В экзаменационной симуляции подсказки отключены.');
  const { data: sc } = await db.from('speaking_scenarios').select('payload').eq('scenario_id', s.scenario_id).single();
  const node = nodeById(sc!.payload as ScenarioPayload, s.current_node ?? '');
  const { data: lastA } = await db.from('speaking_turns').select('text_el').eq('session_id', s.session_id).eq('speaker', 'assistant').order('seq', { ascending: false }).limit(1).maybeSingle();
  if (b.kind === 'hint') {
    return { kind: b.kind, answer_ru: `Цель: ${node?.learner_goal_ru ?? '—'}. Смысл → опорные слова → пример.`, example_el: node?.acceptable_examples_el?.[0] ?? null, source: 'authored', note: 'Пример из сценария — один из возможных, не ключ. Использование подсказки отмечается как помощь.' };
  }
  if (!llmConfigured()) return { kind: b.kind, answer_ru: 'AI-подсказки не подключены. Доступна подсказка из сценария.', example_el: node?.acceptable_examples_el?.[0] ?? null, source: 'unavailable', note: null };
  const prompts: Record<string, string> = {
    translate: `Переведи на русский реплику персонажа: «${lastA?.text_el ?? ''}». Коротко, без пересказа ответа ученика.`,
    explain: `Объясни по-русски кратко (2–3 предложения) фразу или слово: «${(b.question ?? lastA?.text_el ?? '').slice(0, 300)}». Дай один короткий пример на греческом.`,
    how_to_say: `Ученик спрашивает, как сказать по-гречески: «${(b.question ?? '').slice(0, 300)}». Дай одну естественную нейтральную фразу уровня ${(sc!.payload as ScenarioPayload).cefr_level ?? 'A2'} и короткое пояснение по-русски.`,
  };
  const r = await structuredCall({ userId: user.userId, operation: `speaking_help_${b.kind}`, model: env.llmModelDialogue, system: 'Ты помощник-репетитор новогреческого для русскоязычного ученика. Отвечай кратко и точно; не выдумывай фактов о реальном мире.', user: prompts[b.kind], schema: HelpOut, effort: 'low', maxTokens: 1500, timeoutMs: 20_000 });
  if (!r.ok) return { kind: b.kind, answer_ru: 'Подсказка сейчас недоступна. Попробуйте подсказку из сценария.', example_el: null, source: 'error', note: r.reason };
  return { kind: b.kind, ...r.data, source: 'ai_draft', note: 'AI-подсказка (черновик, не материал курса). Использование отмечается как помощь.' };
}

/** Synthesize an assistant line with the persona voice (cached by voice+speed+text in a private bucket). */
export async function speak(user: SessionUser, b: { session_id: string; turn_id: string; rate: SpeedProfile }) {
  const db = adminClient();
  const { data: t } = await db.from('speaking_turns').select('turn_id, user_id, speaker, text_el, session_id').eq('turn_id', b.turn_id).maybeSingle();
  if (!t || t.user_id !== user.userId || t.session_id !== b.session_id || t.speaker !== 'assistant' || !t.text_el) throw new HttpError(404, 'NOT_FOUND', 'Реплика не найдена');
  const { data: s } = await db.from('speaking_sessions').select('voice_persona, mode').eq('session_id', b.session_id).single();
  if (b.rate === 'slow' && s?.mode === 'b2_mock') throw new HttpError(403, 'NO_SLOW_IN_EXAM', 'В экзаменационной симуляции замедление отключено.');
  const voice = await personaVoice(s?.voice_persona ?? 'TUTOR_F');
  if (!voice) throw new HttpError(503, 'TTS_UNAVAILABLE', 'Для выбранного собеседника нет доступного голоса — показан текст реплики.');
  const key = createHash('sha256').update(`${voice.voice_id}|${b.rate}|${t.text_el}`).digest('hex');
  const path = `${voice.provider}/${key}.wav`;
  const existing = await db.storage.from('tts-cache').createSignedUrl(path, 600);
  if (existing.data?.signedUrl) return { url: existing.data.signedUrl, synthetic: true, provider: voice.provider, voice: voice.display_name, cached: true };
  const audio = await synthesizeWithVoice(t.text_el, voice, { speed: b.rate, userId: user.userId, operation: 'tts_dialogue' });
  await db.storage.from('tts-cache').upload(path, audio.bytes, { contentType: 'audio/wav', upsert: true });
  const signed = await db.storage.from('tts-cache').createSignedUrl(path, 600);
  return { url: signed.data?.signedUrl ?? null, synthetic: true, provider: voice.provider, voice: voice.display_name, cached: false };
}

/** Records what part of an interrupted AI turn was actually heard (barge-in). */
export async function markInterrupted(userId: string, sessionId: string, turnId: string, heardMs: number, heardText: string) {
  await adminClient().from('speaking_turns').update({ interrupted: true, playback_completed: false, heard_ms: Math.max(0, Math.round(heardMs)), heard_text: heardText })
    .eq('turn_id', turnId).eq('user_id', userId).eq('session_id', sessionId).eq('speaker', 'assistant');
}

/**
 * End the session. A summary is attempted only with ≥2 confirmed learner turns; mastery evidence
 * only for voice sessions with a validated, high-confidence summary, achieved goal, independent
 * task success and no help — otherwise the session stays practice without mastery changes.
 */
export async function endSession(user: SessionUser, sessionId: string) {
  const db = adminClient();
  const { data: s } = await db.from('speaking_sessions').select('*').eq('session_id', sessionId).maybeSingle();
  if (!s || s.user_id !== user.userId) throw new HttpError(404, 'NOT_FOUND', 'Разговор не найден');
  if (s.status === 'ENDED') return sessionView(user, sessionId);
  const { data: sc } = await db.from('speaking_scenarios').select('payload, competency_ids').eq('scenario_id', s.scenario_id).single();
  const payload = sc!.payload as ScenarioPayload & { unscored?: boolean };
  const { data: turns } = await db.from('speaking_turns').select('turn_id, speaker, text_el, asr_text, transcript_confirmed, help_used, interrupted').eq('session_id', sessionId).order('seq');
  const usable = (turns ?? []).filter((t) => !t.interrupted).map((t) => ({ turn_id: t.turn_id, speaker: t.speaker, text: t.text_el ?? t.asr_text ?? '', confirmed: t.transcript_confirmed }));
  const helpUsed = (turns ?? []).some((t) => t.speaker === 'learner' && ((t.help_used as string[]) ?? []).length > 0);
  let summary: Record<string, unknown> = { status: 'NOT_ASSESSED', reason: 'INSUFFICIENT_TURNS' };
  let masteryEvents: Array<Record<string, unknown>> = [];
  const errorRows: Array<Record<string, unknown>> = [];
  if (payload.unscored) summary = { status: 'NOT_ASSESSED', reason: 'UNSCORED_SCENARIO' };
  else if (!s.preview) {
    const r = await summarizeSession({ userId: user.userId, scenario: payload, mode: s.mode, turns: usable });
    if (r.ok) {
      const sum = r.summary;
      summary = { status: 'ASSESSED_PROVISIONAL', model: r.model, ...sum, label: 'Учебная автоматическая оценка, не официальный экзамен и не оценка произношения' };
      const task = sum.dimensions.find((d) => d.dimension === 'task_success');
      const eligible = s.input_mode === 'voice' && !helpUsed && s.mode !== 'a0_guided' && sum.confidence === 'high' && sum.communicative_goal === 'achieved' && task?.level === 'independent';
      const now = new Date().toISOString();
      const localDate = localDateOf(new Date(), user.profile.timezone);
      if (eligible) {
        masteryEvents = (sc!.competency_ids as string[]).map((cid) => ({
          event_id: randomUUID(), user_id: user.userId, competency_id: cid, attempt_id: null, item_id: `speaking:${s.scenario_id}`,
          event_type: 'independent_correct', task_kind: 'spontaneous', reliable: true, meaning_changing: false, review_interval_days: null,
          supersedes_id: null, local_date: localDate, created_at: now,
        }));
      }
      summary.mastery_counted = eligible;
      summary.mastery_reason = eligible ? 'Самостоятельная устная задача с доказательствами' : s.input_mode !== 'voice' ? 'Текстовый режим не засчитывается как говорение' : helpUsed ? 'Использовались подсказки' : 'Недостаточно надёжного доказательства';
    } else {
      summary = { status: 'ABSTAIN', reason: r.reason, label: 'Итог не сформирован — оценка воздержалась, без штрафа' };
    }
  }
  const idem = `speaking-end-${sessionId}`;
  await db.from('speaking_sessions').update({ status: 'ENDED', ended_at: new Date().toISOString(), summary_private: summary }).eq('session_id', sessionId);
  if (!s.preview) {
    await db.rpc('commit_learning_event', {
      p: {
        user_id: user.userId, idempotency_key: idem, scope: 'speaking', mastery_events: masteryEvents, error_evidence: errorRows,
        events: [{ event_type: 'speaking_session_ended', idempotency_key: idem, payload: { scenario_id: s.scenario_id, mode: s.mode, input_mode: s.input_mode } },
          ...(summary.status === 'ASSESSED_PROVISIONAL' ? [{ event_type: 'speaking_assessed', idempotency_key: idem, payload: { goal: summary.communicative_goal, mastery_counted: summary.mastery_counted } }] : [])],
        // Active time comes from client heartbeats (visible + interacting), never from wall-clock session length.
        activity: { local_date: s.local_date, attempts: 0, active_seconds: 0 },
        result: { ok: true },
      },
    });
    if (masteryEvents.length) await refreshCompetencyState(user.userId, sc!.competency_ids as string[], user.profile.timezone);
  }
  return sessionView(user, sessionId);
}
