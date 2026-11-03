import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { adminClient } from '../supabase/admin.ts';
import { HttpError, type SessionUser } from '../session-user.ts';
import { releaseMap } from '../content/repo.ts';
import { env } from '../env.ts';
import { isLocalLlm, llmConfigured, llmInfo, structuredCall } from '../providers/llm.ts';
import { courseGlossary, glossGreek, glossRussian } from './glossary.ts';
import { asrStatus, synthesizeWithVoice, type SpeedProfile } from '../providers/speech.ts';
import type { CatalogVoice } from '../voice/catalog.ts';
import { localDateOf } from '../learning/calendar.ts';
import { refreshCompetencyState } from '../learning/state.ts';
import { nextTurn, nodeById, isTerminal, summarizeSession, type ScenarioPayload } from './dialogue.ts';
import { conversationTurn, feedbackOnLearnerTurn, mergeMemory, prefillConversation, ruleFeedback, type Memory, type Persona, type TurnFeedback } from './conversation.ts';
import { generationAllowed, qualificationOf } from './qualification.ts';
import { sceneRole } from './personas.ts';
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
  /** Assistant lines: 'llm:<model>' | 'authored' | 'scripted_fallback'. */
  engine: string | null;
  /** Learner lines: validated feedback on the phrase (pending while the model checks it). */
  feedback: (TurnFeedback & { status: 'ready' }) | { status: 'pending' | 'none' | 'failed' } | null;
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
  /** Authored example answers for the current step (one possible wording each — never a key). */
  examples_el: string[];
  /** Steps of the authored scene reached so far (REPAIR/RETRY excluded). */
  progress: { reached: number; total: number; steps: Array<{ node_id: string; goal_ru: string | null; reached: boolean; current: boolean }> };
  objective_ru: string | null;
  domain: string | null;
  engine_label: string;
  /** Who produces the persona's lines in this session. */
  engine: { kind: 'ai' | 'authored'; label_ru: string; short_ru: string; model: string | null; local: boolean; qualification: { cases: number; evaluated_at: string; reply_ok: number; stage_ok: number } | null };
}

/** Main-path steps of the scene (authored order), excluding repair loops. */
function sceneProgress(payload: ScenarioPayload, visited: string[], current: string | null): SessionView['progress'] {
  const main = payload.nodes.filter((n) => !['REPAIR', 'RETRY'].includes(n.node_id));
  const seen = new Set(visited);
  const steps = main.map((n) => ({ node_id: n.node_id, goal_ru: n.learner_goal_ru ?? null, reached: seen.has(n.node_id), current: n.node_id === current }));
  return { reached: steps.filter((x) => x.reached).length, total: steps.length, steps };
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

/** Honest description of the dialogue engine for the learner and the owner. */
export function engineInfo(): SessionView['engine'] {
  const info = llmInfo();
  if (generationAllowed()) {
    const q = info.local ? qualificationOf(info.model) : null;
    return {
      kind: 'ai', model: info.model, local: info.local,
      label_ru: info.local ? `AI-собеседник · локальная модель ${info.model} (прошла автоматическую проверку диалога GreekOS; не экспертная оценка)` : `AI-собеседник · ${info.label_ru}`,
      short_ru: info.local ? 'AI-собеседник · локальная модель' : 'AI-собеседник',
      qualification: q ? { cases: q.cases, evaluated_at: q.evaluated_at, reply_ok: q.metrics.reply_ok, stage_ok: q.metrics.stage_ok } : null,
    };
  }
  const why = !llmConfigured() ? 'AI-модель не подключена' : 'локальная модель не прошла проверку диалога GreekOS';
  return { kind: 'authored', model: info.model, local: info.local, label_ru: `Сценарный режим: ${why} — собеседник говорит авторскими репликами сценария`, short_ru: 'Сценарный режим (без AI)', qualification: null };
}

/** The persona the model plays: voice name (or the scenario's own name if the voice matches) and gender. */
async function personaFor(castRoleId: string | null, scenarioId: string): Promise<Persona> {
  const v = await personaVoice(castRoleId);
  const presentation = (v?.presentation === 'male' || v?.presentation === 'female') ? v.presentation : castRoleId?.endsWith('_M') ? 'male' : 'female';
  const named = sceneRole(scenarioId).name;
  if (named && named.presentation === presentation) return { name: named.el, presentation };
  const voiceName = v?.display_name?.split(/[\s·(]/)[0];
  return { name: voiceName && /\p{Script=Greek}/u.test(voiceName) ? voiceName : presentation === 'male' ? 'Γιώργος' : 'Ελένη', presentation };
}

export async function sessionView(user: SessionUser, sessionId: string): Promise<SessionView> {
  const db = adminClient();
  const { data: s } = await db.from('speaking_sessions').select('*').eq('session_id', sessionId).maybeSingle();
  if (!s || s.user_id !== user.userId) throw new HttpError(404, 'NOT_FOUND', 'Разговор не найден');
  const { data: sc } = await db.from('speaking_scenarios').select('scenario_id, level, domain, objective_ru, payload').eq('scenario_id', s.scenario_id).single();
  const payload = sc!.payload as ScenarioPayload & { unscored?: boolean };
  const { data: turns } = await db.from('speaking_turns').select('turn_id, seq, speaker, text_el, asr_text, node_id, transcript_confirmed, interrupted, help_used, intent, engine, feedback').eq('session_id', sessionId).order('seq');
  const node = nodeById(payload, s.current_node ?? payload.entry_node);
  const voice = await personaVoice(s.voice_persona);
  return {
    session_id: s.session_id, scenario_id: s.scenario_id, title: `${sc!.domain ?? ''}`, level: sc!.level, mode: s.mode, input_mode: s.input_mode,
    status: s.status, current_node: s.current_node, goal_ru: node?.learner_goal_ru ?? sc!.objective_ru, ended_node: isTerminal(node),
    turns: (turns ?? []).map((t) => ({
      turn_id: t.turn_id, seq: t.seq, speaker: t.speaker, text: t.text_el ?? t.asr_text ?? '', node_id: t.node_id, confirmed: t.transcript_confirmed,
      interrupted: t.interrupted, generated: t.intent === 'generated', help: (t.help_used as string[]) ?? [], source: t.speaker === 'learner' ? t.intent : null,
      engine: t.engine ?? null, feedback: (t.feedback as TurnView['feedback']) ?? null,
    })),
    summary: (s.summary_private as Record<string, unknown>) ?? null,
    preview: s.preview,
    providers: providers(voice),
    hints_allowed: HINTS_ALLOWED(s.mode),
    unscored: !!payload.unscored,
    persona: { cast_role_id: s.voice_persona, voice_id: voice?.voice_id ?? null, voice_name: voice?.display_name ?? null, presentation: voice?.presentation ?? null, engine: voice?.engine_kind ?? null, dev_only: voice ? !voice.distribution_allowed : false },
    transport: s.transport,
    examples_el: HINTS_ALLOWED(s.mode) ? (node?.acceptable_examples_el ?? []).slice(0, 3) : [],
    progress: sceneProgress(payload, (turns ?? []).map((t) => t.node_id).filter((x): x is string => !!x), s.current_node),
    objective_ru: sc!.objective_ru ?? null,
    domain: sc!.domain ?? null,
    engine_label: engineInfo().label_ru,
    engine: engineInfo(),
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
  // Free talk starts from a neutral opener on the scenario's theme, not from a scene's dramatic first line.
  const opening = b.mode === 'free_talk' ? freeTalkOpener(sceneRole(row.scenario_id).register) : entry?.assistant_el ?? '';
  const { data: s, error } = await db.from('speaking_sessions').insert({
    user_id: user.userId, scenario_id: row.scenario_id, scenario_hash: row.current_hash, mode: b.mode, input_mode: b.input_mode,
    current_node: payload.entry_node, provider_snapshot: providers(await personaVoice(b.voice_persona ?? null)), preview, local_date: localDateOf(new Date(), user.profile.timezone),
    voice_persona: b.voice_persona ?? null, transport: b.input_mode === 'voice' && b.transport === 'stream_local_gateway' ? 'stream_local_gateway' : 'batch',
  }).select('session_id').single();
  if (error) throw error;
  await db.from('speaking_turns').insert({ session_id: s.session_id, user_id: user.userId, seq: 0, speaker: 'assistant', node_id: payload.entry_node, text_el: opening, transcript_confirmed: true, idempotency_key: `${b.idempotency_key}:open`, intent: 'authored', engine: 'authored' });
  return sessionView(user, s.session_id);
}

/** Neutral, level-safe openers for free conversation (authored here; plain everyday Greek). */
function freeTalkOpener(register: 'εσείς' | 'εσύ'): string {
  return register === 'εσύ' ? 'Γεια σου! Τι κάνεις; Πώς πάει η μέρα σου;' : 'Γεια σας! Τι κάνετε; Πώς πάει η μέρα σας;';
}

export type LearnerSource = 'asr_confirmed' | 'asr_auto' | 'learner_corrected' | 'typed';

export interface TurnStreamOptions {
  /** Pre-assigned id of the persona line, so a streaming gateway can voice it before it is stored. */
  assistantTurnId?: string;
  /** Each validated sentence of a generated reply, as soon as it exists. */
  onSentence?: (sentence: string, index: number) => void;
  /** Barge-in: stops generation; what was already said is stored as the line. */
  signal?: AbortSignal;
}

export interface TurnResult extends SessionView {
  engine_kind: 'llm' | 'authored' | 'scripted_fallback';
  engine_reason: string | null;
  hint_ru: string | null;
  intent: string;
  gen_first_ms: number | null;
  /** Feedback on the learner phrase and pre-warming of the next turn; resolves with a fresh view. */
  background: Promise<SessionView | null>;
}

export async function learnerTurn(user: SessionUser, b: { session_id: string; text: string; source: LearnerSource; asr_confidence: number | null; help_used: string[]; repair: boolean; interrupted_previous: boolean; idempotency_key: string }, opts: TurnStreamOptions = {}): Promise<TurnResult> {
  const db = adminClient();
  const { data: s } = await db.from('speaking_sessions').select('*').eq('session_id', b.session_id).maybeSingle();
  if (!s || s.user_id !== user.userId) throw new HttpError(404, 'NOT_FOUND', 'Разговор не найден');
  if (s.status !== 'ACTIVE') throw new HttpError(409, 'SESSION_CLOSED', 'Разговор уже завершён');
  if (s.input_mode === 'voice' && b.source === 'typed' && !b.repair) throw new HttpError(422, 'VOICE_SESSION', 'В голосовом режиме ответ отправляется голосом.');
  const replay = await db.from('speaking_turns').select('turn_id').eq('user_id', user.userId).eq('idempotency_key', `${b.idempotency_key}:a`).maybeSingle();
  if (replay.data) return { ...(await sessionView(user, b.session_id)), engine_kind: 'authored', engine_reason: 'IDEMPOTENT_REPLAY', hint_ru: null, intent: 'replay', gen_first_ms: null, background: Promise.resolve(null) };

  const { data: sc } = await db.from('speaking_scenarios').select('payload, level').eq('scenario_id', s.scenario_id).single();
  const payload = sc!.payload as ScenarioPayload;
  const { data: prior } = await db.from('speaking_turns').select('turn_id, seq, speaker, text_el, asr_text, transcript_confirmed, interrupted, heard_text').eq('session_id', s.session_id).order('seq');
  const seq = (prior?.at(-1)?.seq ?? 0) + 1;
  if (b.interrupted_previous) {
    const lastA = [...(prior ?? [])].reverse().find((t) => t.speaker === 'assistant');
    if (lastA) await db.from('speaking_turns').update({ interrupted: true, playback_completed: false }).eq('turn_id', lastA.turn_id);
  }
  const text = b.text.trim().slice(0, 1200);
  const ai = generationAllowed();
  // Feedback is proposed by a usable model, for Greek phrases, never during an exam turn. Without a
  // model, only the deterministic grammar rules (labelled as rules) are applied, synchronously.
  const feedbackTurn = !b.repair && /\p{Script=Greek}/u.test(text) && s.mode !== 'b2_mock';
  const wantsFeedback = ai && feedbackTurn;
  const ruleOnly = !ai && feedbackTurn ? ruleFeedback(text) : null;
  let learnerTurnId: string | null = null;
  if (!b.repair) {
    if (!text) throw new HttpError(422, 'EMPTY_TURN', 'Пустая реплика не отправляется.');
    const ins = await db.from('speaking_turns').insert({
      session_id: s.session_id, user_id: user.userId, seq, speaker: 'learner', node_id: s.current_node, text_el: text,
      asr_text: b.source === 'typed' ? null : text, asr_confidence: b.asr_confidence, asr_provider: b.source === 'typed' ? null : (s.provider_snapshot as { asr?: string }).asr ?? null,
      transcript_confirmed: b.source !== 'typed', help_used: b.help_used, idempotency_key: `${b.idempotency_key}:l`, intent: b.source,
      feedback: wantsFeedback ? { status: 'pending' } : ruleOnly ? { ...ruleOnly, status: 'ready' } : null,
    }).select('turn_id').maybeSingle();
    if (ins.error && ins.error.code !== '23505') throw ins.error;
    learnerTurnId = ins.data?.turn_id ?? null;
  }
  // Only what the learner actually heard counts as context: interrupted AI turns are truncated.
  const history = (prior ?? []).map((t) => ({ role: t.speaker === 'learner' ? 'learner' as const : 'assistant' as const, text: t.speaker === 'assistant' && t.interrupted ? t.heard_text ?? '' : t.text_el ?? t.asr_text ?? '' }));
  const memory = ((s.memory as Memory | null) ?? { facts: [] });
  const persona = await personaFor(s.voice_persona, s.scenario_id);

  let d: { nextNode: string; assistantEl: string; generated: boolean; intent: string; hintRu: string | null; repairLoops: number; facts: string[]; firstMs: number | null; totalMs: number | null };
  let engine: TurnResult['engine_kind'];
  let dbEngine: string;
  let reason: string | null = null;
  if (ai) {
    const t = await conversationTurn({
      userId: user.userId, sessionId: s.session_id, scenario: payload, mode: s.mode, level: sc!.level, currentNode: s.current_node ?? payload.entry_node,
      history, learnerText: b.repair ? '' : text, repairRequested: b.repair, repairLoops: s.repair_loops, memory, persona,
      signal: opts.signal, onSentence: opts.onSentence,
    });
    d = { nextNode: t.nextNode, assistantEl: t.assistantEl, generated: t.generated, intent: t.intent, hintRu: t.hintRu, repairLoops: t.repairLoops, facts: t.facts, firstMs: t.firstSentenceMs, totalMs: t.totalMs };
    engine = t.engine === 'llm' ? 'llm' : 'scripted_fallback';
    dbEngine = t.engine === 'llm' ? `llm:${t.engineDetail}` : 'scripted_fallback';
    reason = t.engine === 'llm' ? null : t.engineDetail;
  } else {
    const decision = await nextTurn({ userId: user.userId, scenario: payload, mode: s.mode, currentNode: s.current_node ?? payload.entry_node, history, learnerText: b.repair ? '' : text, repairRequested: b.repair, repairLoops: s.repair_loops });
    d = { nextNode: decision.nextNode, assistantEl: decision.assistantEl, generated: false, intent: decision.intent, hintRu: decision.hintRu, repairLoops: decision.repairLoops, facts: [], firstMs: null, totalMs: null };
    // No generating model: the authored line is the design of this mode, not a failure.
    engine = 'authored';
    dbEngine = 'authored';
    reason = decision.engine === 'scripted_fallback' && llmConfigured() ? 'CLASSIFIER_UNAVAILABLE' : null;
  }
  const assistantSeq = b.repair ? seq : seq + 1;
  const ains = await db.from('speaking_turns').insert({
    ...(opts.assistantTurnId ? { turn_id: opts.assistantTurnId } : {}),
    session_id: s.session_id, user_id: user.userId, seq: assistantSeq, speaker: 'assistant', node_id: d.nextNode, text_el: d.assistantEl,
    transcript_confirmed: true, idempotency_key: `${b.idempotency_key}:a`, intent: d.generated ? 'generated' : 'authored',
    help_used: d.hintRu ? [`hint:${d.hintRu}`] : [], engine: dbEngine, gen_first_ms: d.firstMs, gen_total_ms: d.totalMs,
  });
  if (ains.error && ains.error.code !== '23505') throw ains.error;
  const newMemory = d.facts.length ? mergeMemory(memory, d.facts) : memory;
  await db.from('speaking_sessions').update({ current_node: d.nextNode, repair_loops: d.repairLoops, memory: newMemory }).eq('session_id', s.session_id);

  const background = (async (): Promise<SessionView | null> => {
    if (wantsFeedback && learnerTurnId) {
      const lastA = [...history].reverse().find((h) => h.role === 'assistant')?.text ?? null;
      try {
        const fb = await feedbackOnLearnerTurn({ userId: user.userId, sessionId: s.session_id, learnerText: text, context: lastA, level: sc!.level });
        await db.from('speaking_turns').update({ feedback: fb ? { ...fb, status: 'ready' } : { status: 'none' } }).eq('turn_id', learnerTurnId);
      } catch {
        await db.from('speaking_turns').update({ feedback: { status: 'failed' } }).eq('turn_id', learnerTurnId);
      }
    }
    // Warm the next turn while the learner listens and thinks.
    if (ai) {
      const nextHistory = [...history, ...(b.repair ? [] : [{ role: 'learner' as const, text }]), { role: 'assistant' as const, text: d.assistantEl }];
      await prefillConversation({ userId: user.userId, sessionId: s.session_id, scenario: payload, mode: s.mode, level: sc!.level, history: nextHistory, persona }).catch(() => null);
    }
    return wantsFeedback ? sessionView(user, s.session_id) : null;
  })();
  background.catch(() => undefined);
  return { ...(await sessionView(user, s.session_id)), engine_kind: engine, engine_reason: reason, hint_ru: d.hintRu, intent: d.intent, gen_first_ms: d.firstMs, background };
}

/** Pre-evaluates a session's opening so the first learner turn is fast (call when the learner opens the scene). */
export async function warmSession(user: SessionUser, sessionId: string): Promise<number | null> {
  if (!generationAllowed()) return null;
  const db = adminClient();
  const { data: s } = await db.from('speaking_sessions').select('session_id, user_id, scenario_id, mode, voice_persona, status').eq('session_id', sessionId).maybeSingle();
  if (!s || s.user_id !== user.userId || s.status !== 'ACTIVE') return null;
  const { data: sc } = await db.from('speaking_scenarios').select('payload, level').eq('scenario_id', s.scenario_id).single();
  const { data: turns } = await db.from('speaking_turns').select('speaker, text_el, interrupted, heard_text').eq('session_id', sessionId).order('seq');
  const history = (turns ?? []).map((t) => ({ role: t.speaker === 'learner' ? 'learner' as const : 'assistant' as const, text: t.speaker === 'assistant' && t.interrupted ? t.heard_text ?? '' : t.text_el ?? '' }));
  return prefillConversation({ userId: user.userId, sessionId, scenario: sc!.payload as ScenarioPayload, mode: s.mode, level: sc!.level, history, persona: await personaFor(s.voice_persona, s.scenario_id) });
}

const HelpOut = z.object({ answer_ru: z.string(), example_el: z.string().nullable() });

/** On-demand tutor help; the dialogue state is not touched, so the learner returns to the same scene. */
export async function help(user: SessionUser, b: { session_id: string; kind: 'hint' | 'translate' | 'explain' | 'how_to_say' | 'why'; question?: string }) {
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
  if (!llmConfigured() || llmInfo().local) {
    // No AI model validated for Greek: answer only from authored course material, never generate.
    const glossary = await courseGlossary(user);
    const found = b.kind === 'how_to_say' ? glossRussian(b.question ?? '', glossary) : glossGreek(b.question?.trim() || lastA?.text_el || '', glossary);
    const note = llmConfigured() ? 'Локальная AI-модель не проверена для греческого, поэтому подсказка — только из словаря курса.' : 'AI-подсказки не подключены; ответ — из словаря курса.';
    if (!found.length) return { kind: b.kind, answer_ru: b.kind === 'why' ? 'Объяснение правил требует проверенной AI-модели. Посмотрите теорию урока или возьмите подсказку сценария.' : 'В словаре открытых вам уроков этого нет. Возьмите подсказку сценария.', example_el: node?.acceptable_examples_el?.[0] ?? null, source: 'course_glossary', note };
    return { kind: b.kind, answer_ru: found.map((g) => `${g.lemma} — ${g.meaning_ru}`).join('; '), example_el: found.find((g) => g.example)?.example ?? null, source: 'course_glossary', note: `${note} Уроки: ${[...new Set(found.map((g) => g.unit_title))].slice(0, 2).join(', ')}.` };
  }
  const prompts: Record<string, string> = {
    translate: `Переведи на русский реплику персонажа: «${lastA?.text_el ?? ''}». Коротко, без пересказа ответа ученика.`,
    explain: `Объясни по-русски кратко (2–3 предложения) фразу или слово: «${(b.question ?? lastA?.text_el ?? '').slice(0, 300)}». Дай один короткий пример на греческом.`,
    why: `Ученик спрашивает «Почему так?» о реплике или исправлении: «${(b.question ?? lastA?.text_el ?? '').slice(0, 300)}». Объясни по-русски правило в 2–3 предложениях (грамматика, порядок слов или регистр) и дай один короткий греческий пример.`,
    how_to_say: `Ученик спрашивает, как сказать по-гречески: «${(b.question ?? '').slice(0, 300)}». Дай одну естественную нейтральную фразу уровня ${(sc!.payload as ScenarioPayload).cefr_level ?? 'A2'} и короткое пояснение по-русски.`,
  };
  const r = await structuredCall({ userId: user.userId, operation: `speaking_help_${b.kind}`, model: env.llmModelDialogue, system: 'Ты помощник-репетитор новогреческого для русскоязычного ученика. Отвечай кратко и точно; не выдумывай фактов о реальном мире.', user: prompts[b.kind], schema: HelpOut, effort: 'low', maxTokens: 1500, timeoutMs: env.llmTurnTimeoutMs });
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

/** Voices one authored example of the CURRENT step («Полезные фразы») with the persona voice (cached). */
export async function sayExample(user: SessionUser, b: { session_id: string; text: string; rate: SpeedProfile }) {
  const db = adminClient();
  const { data: s } = await db.from('speaking_sessions').select('user_id, scenario_id, current_node, voice_persona, mode').eq('session_id', b.session_id).maybeSingle();
  if (!s || s.user_id !== user.userId) throw new HttpError(404, 'NOT_FOUND', 'Разговор не найден');
  if (!HINTS_ALLOWED(s.mode)) throw new HttpError(403, 'NO_HINTS', 'В экзаменационной симуляции подсказки отключены.');
  const { data: sc } = await db.from('speaking_scenarios').select('payload').eq('scenario_id', s.scenario_id).single();
  const node = nodeById(sc!.payload as ScenarioPayload, s.current_node ?? '');
  if (!(node?.acceptable_examples_el ?? []).includes(b.text)) {
    // Also the corrected forms validated for this learner's own phrases in this session.
    const { data: fbs } = await db.from('speaking_turns').select('feedback').eq('session_id', b.session_id).eq('speaker', 'learner').not('feedback', 'is', null);
    const corrected = (fbs ?? []).map((r) => (r.feedback as { status?: string; better_el?: string }) ?? {}).filter((f) => f.status === 'ready').map((f) => f.better_el);
    if (!corrected.includes(b.text)) throw new HttpError(403, 'NOT_IN_STEP', 'Озвучиваются только фразы текущего шага и исправления ваших фраз.');
  }
  const voice = await personaVoice(s.voice_persona ?? 'TUTOR_F');
  if (!voice) throw new HttpError(503, 'TTS_UNAVAILABLE', 'Голос недоступен.');
  const key = createHash('sha256').update(`${voice.voice_id}|${b.rate}|${b.text}`).digest('hex');
  const path = `${voice.provider}/${key}.wav`;
  const existing = await db.storage.from('tts-cache').createSignedUrl(path, 600);
  if (existing.data?.signedUrl) return { url: existing.data.signedUrl, synthetic: true, voice: voice.display_name, cached: true };
  const audio = await synthesizeWithVoice(b.text, voice, { speed: b.rate, userId: user.userId, operation: 'tts_example' });
  await db.storage.from('tts-cache').upload(path, audio.bytes, { contentType: 'audio/wav', upsert: true });
  const signed = await db.storage.from('tts-cache').createSignedUrl(path, 600);
  return { url: signed.data?.signedUrl ?? null, synthetic: true, voice: voice.display_name, cached: false };
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
  // Feedback on the last phrases may still be running: give it a short moment so the summary is complete.
  for (let i = 0; i < 25; i++) {
    const { count } = await db.from('speaking_turns').select('turn_id', { count: 'exact', head: true }).eq('session_id', sessionId).eq('speaker', 'learner').eq('feedback->>status', 'pending');
    if (!count) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const { data: turns } = await db.from('speaking_turns').select('turn_id, speaker, text_el, asr_text, transcript_confirmed, help_used, interrupted, feedback, node_id, engine').eq('session_id', sessionId).order('seq');
  const usable = (turns ?? []).filter((t) => !t.interrupted).map((t) => ({ turn_id: t.turn_id, speaker: t.speaker, text: t.text_el ?? t.asr_text ?? '', confirmed: t.transcript_confirmed }));
  // The 2–3 main points from the validated per-phrase feedback (errors before style notes).
  const feedbackPoints = (turns ?? []).filter((t) => t.speaker === 'learner' && (t.feedback as { status?: string } | null)?.status === 'ready')
    .map((t) => ({ turn_id: t.turn_id, ...(t.feedback as TurnFeedback) }))
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'error' ? -1 : 1)).slice(0, 3);
  const prog = sceneProgress(payload, (turns ?? []).map((t) => t.node_id).filter((x): x is string => !!x), s.current_node);
  const aiTurns = (turns ?? []).filter((t) => t.speaker === 'assistant' && String(t.engine ?? '').startsWith('llm:')).length;
  const fallbackTurns = (turns ?? []).filter((t) => t.engine === 'scripted_fallback').length;
  const helpUsed = (turns ?? []).some((t) => t.speaker === 'learner' && ((t.help_used as string[]) ?? []).length > 0);
  let summary: Record<string, unknown> = { status: 'NOT_ASSESSED', reason: 'INSUFFICIENT_TURNS' };
  let masteryEvents: Array<Record<string, unknown>> = [];
  const errorRows: Array<Record<string, unknown>> = [];
  const learnerCount = usable.filter((t) => t.speaker === 'learner').length;
  if (payload.unscored) summary = { status: 'NOT_ASSESSED', reason: 'UNSCORED_SCENARIO' };
  else if (generationAllowed() && isLocalLlm()) {
    // Local model: feedback only — validated suggestions on real phrases, no grade, no mastery change.
    summary = {
      status: 'AI_FEEDBACK', corrections: feedbackPoints, learner_turns: learnerCount, ai_turns: aiTurns, fallback_turns: fallbackTurns,
      progress: { reached: prog.reached, total: prog.total, closed: !!nodeById(payload, s.current_node ?? '') && isTerminal(nodeById(payload, s.current_node ?? '')) && s.current_node !== 'RETRY' },
      help_used: helpUsed,
      next_step_ru: feedbackPoints.length ? 'Послушайте и произнесите исправленные фразы, затем пройдите сцену ещё раз своими словами.' : learnerCount < 2 ? 'Скажите хотя бы две реплики — тогда появится разбор.' : 'Ошибок, которые правила курса и модель уверенно нашли, нет. Попробуйте ту же сцену на уровень сложнее или свободный разговор.',
      label: `Подсказки локальной модели ${llmInfo().model ?? ''}: она прошла автоматическую проверку GreekOS, но это не экспертная оценка. На освоение компетенций не влияет.`,
      mastery_counted: false, mastery_reason: 'оценку локальной модели не засчитываем как доказательство освоения',
    };
  } else if (!s.preview) {
    const r = await summarizeSession({ userId: user.userId, scenario: payload, mode: s.mode, turns: usable });
    if (r.ok) {
      const sum = r.summary;
      const unvalidated = llmInfo().local;
      summary = { status: 'ASSESSED_PROVISIONAL', model: r.model, ...sum, unvalidated_model: unvalidated, label: unvalidated ? 'Черновой итог локальной модели, не проверенной для греческого: только для разработки, на освоение не влияет' : 'Учебная автоматическая оценка, не официальный экзамен и не оценка произношения' };
      const task = sum.dimensions.find((d) => d.dimension === 'task_success');
      const eligible = !unvalidated && s.input_mode === 'voice' && !helpUsed && s.mode !== 'a0_guided' && sum.confidence === 'high' && sum.communicative_goal === 'achieved' && task?.level === 'independent';
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
      summary.mastery_reason = eligible ? 'Самостоятельная устная задача с доказательствами' : unvalidated ? 'оценивала невалидированная локальная модель' : s.input_mode !== 'voice' ? 'Текстовый режим не засчитывается как говорение' : helpUsed ? 'Использовались подсказки' : 'Недостаточно надёжного доказательства';
    } else {
      summary = { status: 'ABSTAIN', reason: r.reason, label: r.reason === 'LOCAL_MODEL_NOT_VALIDATED' ? 'Итог не формируется: подключена только локальная модель, не проверенная для греческого. Реплики сохранены, без штрафа.' : r.reason === 'INSUFFICIENT_TURNS' ? (s.input_mode === 'voice' ? 'Итог не сформирован: нужно хотя бы две подтверждённые голосовые реплики. Без штрафа.' : 'Итог не сформирован: текстовый режим не оценивается как говорение. Без штрафа.') : 'Итог не сформирован — оценка воздержалась, без штрафа' };
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
