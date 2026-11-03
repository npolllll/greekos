/**
 * Conversation engine v2 — the generative Greek interlocutor.
 *
 * One turn = one streamed, schema-constrained LLM call whose first field is the spoken reply: each
 * finished sentence passes the Greek guard and is handed to the voice at once (onSentence), while the
 * model goes on to choose the scene stage and the facts to remember. Feedback on the learner's
 * phrase is a separate, non-blocking call (feedbackOnLearnerTurn) so it never delays the reply.
 *
 * The authored scenario stays the pedagogical frame (stages, learner goals, example lines), not a
 * script to recite. If the model fails (timeout, invalid output, guard), the learner hears the
 * authored line of the stage and the turn is labelled 'scripted_fallback' — never passed off as AI.
 */
import { z } from 'zod';
import { env } from '../env.ts';
import { streamJson } from '../providers/llm-stream.ts';
import { isLocalLlm, llmInfo } from '../providers/llm.ts';
import { HINTS_ALLOWED, type SpeakingMode } from './state-machine.ts';
import { nodeById, isTerminal, type ScenarioNode, type ScenarioPayload, type TurnContext } from './dialogue.ts';
import { JsonFieldStream, SentenceCutter } from './stream-json.ts';
import { fixNumeralAgreement, guardGreek, greekWords } from './greek-guard.ts';
import { generationAllowed } from './qualification.ts';
import { sceneRole } from './personas.ts';

export const CONVERSATION_ENGINE_VERSION = 'greekos-conversation/2.0';

export interface Persona { name: string; presentation: 'female' | 'male' | null }
export interface Memory { facts: string[] }

export interface ConversationTurnInput {
  userId: string | null;
  sessionId: string;
  scenario: ScenarioPayload & { module?: string; learner_brief_ru?: string };
  mode: SpeakingMode;
  level: string | null;
  currentNode: string;
  history: TurnContext[];
  learnerText: string;
  repairRequested: boolean;
  repairLoops: number;
  memory: Memory;
  persona: Persona;
  signal?: AbortSignal;
  /** Called with each validated sentence of the reply as soon as it is complete. */
  onSentence?: (sentence: string, index: number) => void;
}

export interface ConversationTurn {
  nextNode: string;
  assistantEl: string;
  engine: 'llm' | 'scripted_fallback' | 'authored';
  engineDetail: string; // model name or the fallback reason
  generated: boolean;
  intent: string;
  hintRu: string | null;
  ended: boolean;
  repairLoops: number;
  facts: string[];
  firstSentenceMs: number | null;
  totalMs: number;
  guard: { fixes: string[]; problems: string[] };
}

/** Opening of every turn's service block (shared with prefill so the cached prefix matches). */
const SERVICE_NOTE = '[Служебно — это не слова ученика]';

const INTENTS = ['on_task', 'clarification_request', 'code_switch', 'off_task', 'unintelligible', 'goal_achieved'] as const;

const LEVEL_RU: Record<string, string> = {
  A0: 'абсолютный новичок: 3–7 слов в предложении, только настоящее время и самые частые слова; говори очень просто и дружелюбно',
  A1: 'A1: короткие простые предложения (до 10 слов), настоящее время, частотная лексика',
  A2: 'A2: простые предложения, можно прошедшее и будущее время, бытовая лексика',
  B1: 'B1: естественная разговорная речь, связные предложения, умеренный темп',
  B2: 'B2: естественная беглая речь, богатая лексика и связки, как с носителем',
};

const MAX_TOKENS: Record<string, number> = { A0: 90, A1: 110, A2: 140, B1: 190, B2: 240 };

function levelKey(level: string | null | undefined): string {
  return (level ?? 'A2').slice(0, 2).toUpperCase();
}

function mainStages(s: ScenarioPayload) {
  return s.nodes.filter((n) => !['REPAIR', 'RETRY'].includes(n.node_id));
}

/** Words the guard accepts even if hunspell does not know them: the scenario's own vetted Greek and the persona name. */
export function scenarioVocabulary(s: ScenarioPayload, persona: Persona): Set<string> {
  const words = new Set<string>(greekWords(persona.name));
  for (const n of s.nodes) {
    for (const w of greekWords(n.assistant_el)) words.add(w);
    for (const ex of n.acceptable_examples_el ?? []) for (const w of greekWords(ex)) words.add(w);
  }
  return words;
}

/** Stable per session (kept identical across turns so a local server can reuse its KV cache). */
export function systemPrompt(p: { scenario: ConversationTurnInput['scenario']; mode: SpeakingMode; level: string | null; persona: Persona }): string {
  const s = p.scenario;
  const lv = levelKey(p.level ?? s.cefr_level);
  const role = sceneRole(s.scenario_id);
  const gender = p.persona.presentation === 'male' ? 'Ты мужчина: о себе говори в мужском роде.' : p.persona.presentation === 'female' ? 'Ты женщина: о себе говори в женском роде.' : '';
  const mode = p.mode === 'b2_mock'
    ? 'Это учебная симуляция устного экзамена ΚΕΓ B2: ты экзаменатор, вежливо на «εσείς» ведёшь задание и задаёшь уточняющие вопросы; не подсказываешь и не исправляешь.'
    : p.mode === 'free_talk'
      ? `Это свободный разговор (тема для начала — «${s.domain ?? ''}»): живая беседа, реагируй на сказанное, задавай вопросы о жизни и мнении ученика, иногда коротко рассказывай о себе.`
      : `Сцена «${s.domain ?? ''}»: ${s.learning_objective ?? ''}.${p.mode === 'real_greek' ? ' Используй естественные современные разговорные обороты.' : ''}`;
  // One worked example from this very scene (authored lines): role, register and length at a glance.
  const open = nodeById(s, s.entry_node);
  const nextId = open?.transitions.find((t) => !['REPAIR', 'RETRY'].includes(t.to))?.to;
  const next = nextId ? nodeById(s, nextId) : undefined;
  const sample = p.mode !== 'free_talk' && open?.acceptable_examples_el?.[0] && next
    ? `Пример хода в этой сцене. Ты сказал(а): «${open.assistant_el}» Ученик: «${open.acceptable_examples_el[0]}» Твой ответ: {"stage":"${next.node_id}","reply_el":"${next.assistant_el.replace(/"/g, '\\"')}", ...}`
    : '';
  return [
    `Ты — ${p.persona.name}, ${role.persona}. Ученик — ${role.learner}. Обращайся к ученику на «${role.register}». ${gender} Место действия — Салоники, Греция.`,
    mode,
    `Ученик — русскоязычный, уровень ${LEVEL_RU[lv] ?? LEVEL_RU.A2}. В сообщениях пользователя есть служебные пометки для тебя по-русски и в конце — слова ученика в кавычках «»: отвечай только на слова ученика.`,
    `Правила reply_el: только твоя реплика на новогреческом (без русского и латиницы), 1–2 коротких предложения. Ты говоришь от своей роли, никогда от лица ученика. Сначала коротко отреагируй на конкретные слова ученика (например, на «Θέλω δύο κιλά πορτοκάλια» — «Δύο κιλά πορτοκάλια, βεβαίως.»), затем сделай шаг, который требует выбранный stage. Если ученик ошибся, не повторяй ошибку — сам используй правильную форму. Держи цены, время и количества последовательными (см. «Факты»).`,
    sample,
  ].filter(Boolean).join('\n\n');
}

function turnSchema(allowed: string[], withHint: boolean) {
  // The stage comes first (a few tokens) so the reply is written for the branch the model chose.
  const props: Record<string, unknown> = {
    stage: { type: 'string', enum: allowed },
    reply_el: { type: 'string' },
    intent: { type: 'string', enum: [...INTENTS] },
  };
  if (withHint) props.hint_ru = { anyOf: [{ type: 'string' }, { type: 'null' }] };
  props.facts = { type: 'array', items: { type: 'string' }, maxItems: 2 };
  return { type: 'object', properties: props, required: Object.keys(props), additionalProperties: false };
}

const TurnOut = z.object({
  reply_el: z.string(),
  stage: z.string(),
  intent: z.enum(INTENTS),
  hint_ru: z.string().nullable().optional(),
  facts: z.array(z.string()).max(4).default([]),
});

/** Messages: only what the learner actually heard counts as context (interrupted turns are truncated upstream). */
function chatMessages(history: TurnContext[], stateBlock: string): Array<{ role: 'user' | 'assistant'; content: string }> {
  const out: Array<{ role: 'user' | 'assistant'; content: string }> = [{ role: 'user', content: '(Начало разговора. Начни.)' }];
  for (const h of history) {
    if (!h.text) continue;
    const role = h.role === 'learner' ? 'user' : 'assistant';
    const prev = out[out.length - 1];
    if (prev.role === role) prev.content += `\n${h.text}`;
    else out.push({ role, content: h.text });
  }
  if (out[out.length - 1].role === 'user') out[out.length - 1].content += `\n\n${stateBlock}`;
  else out.push({ role: 'user', content: stateBlock });
  return out;
}

/** What each allowed next step means and which line (function, not text to recite) it calls for. */
function branches(s: ScenarioPayload, node: ScenarioNode, allowed: string[], mode: SpeakingMode): string {
  const lines = [`Сейчас этап ${node.node_id}. Цель ученика на этом этапе: ${node.learner_goal_ru ?? '—'}.`, 'Выбери stage:'];
  for (const id of allowed) {
    const target = nodeById(s, id);
    if (!target) continue;
    if (id === node.node_id) { lines.push(`- ${id} — ученик ответил не по существу этапа: ${mode === 'b2_mock' ? 'попроси уточнить' : 'помоги ему продолжить, проще'}.`); continue; }
    if (id === 'REPAIR') { lines.push('- REPAIR — только если ученик прямо говорит, что не понял, просит повторить, или говорит не по-гречески. Ошибки в греческом — НЕ повод для REPAIR. Реплика: повтори свою мысль проще и короче.'); continue; }
    if (id === 'RETRY') { lines.push('- RETRY — разговор явно не получается после нескольких попыток. Реплика: мягко предложи начать заново.'); continue; }
    const cond = node.transitions.find((t) => t.to === id)?.condition ?? '';
    lines.push(`- ${id} — ${cond} (ученик ответил по существу, даже если с ошибками). Реплика: коротко отреагируй на его слова и передай смысл «${target.assistant_el}» своими словами.`);
  }
  return lines.join('\n');
}

function fallbackTurn(input: ConversationTurnInput, target: string, reason: string, started: number): ConversationTurn {
  const node = nodeById(input.scenario, target) ?? nodeById(input.scenario, input.currentNode)!;
  return {
    nextNode: node.node_id, assistantEl: node.assistant_el, engine: 'scripted_fallback', engineDetail: reason, generated: false,
    intent: 'scripted_advance', hintRu: null, ended: isTerminal(node), repairLoops: input.repairLoops, facts: [],
    firstSentenceMs: null, totalMs: Date.now() - started, guard: { fixes: [], problems: [reason] },
  };
}

/**
 * Generates the persona's next turn. Without a usable model (none configured, or a local model that
 * has not passed the GreekOS dialogue qualification) the caller should use the authored engine instead.
 */
const LEARNER_SAID = '[Ученик сказал]: «';

/**
 * Service notes of a turn (Russian, for the model only), before the learner's own words, which come
 * last and quoted. They depend only on the state before the learner speaks, so a warm-up can evaluate
 * them while the learner is still talking.
 */
function stateLines(input: Pick<ConversationTurnInput, 'scenario' | 'mode' | 'memory'>, node: ScenarioNode, allowed: string[]): string[] {
  const free = input.mode === 'free_talk';
  return [
    SERVICE_NOTE,
    input.memory.facts.length ? `Факты сцены: ${input.memory.facts.join('; ')}.` : '',
    free ? 'Продолжи разговор: отреагируй на слова ученика и задай вопрос.' : branches(input.scenario, node, allowed, input.mode),
    HINTS_ALLOWED(input.mode) ? 'hint_ru — подсказка по-русски, что ученик может сказать, только если он явно затрудняется, иначе null.' : '',
    'facts — 0–2 новых факта сцены по-русски (очень коротко), иначе [].',
  ].filter(Boolean);
}

function allowedStages(s: ScenarioPayload, node: ScenarioNode, mode: SpeakingMode): string[] {
  return mode === 'free_talk' ? [node.node_id] : [...new Set([node.node_id, ...node.transitions.map((t) => t.to)])].filter((id) => nodeById(s, id));
}

export async function conversationTurn(input: ConversationTurnInput): Promise<ConversationTurn> {
  const started = Date.now();
  const s = input.scenario;
  const node = nodeById(s, input.currentNode) ?? nodeById(s, s.entry_node)!;
  const maxRepairs = s.off_script_policy?.max_repair_loops ?? 2;
  const free = input.mode === 'free_talk';
  const allowed = allowedStages(s, node, input.mode);
  const lv = levelKey(input.level ?? s.cefr_level);
  const withHint = HINTS_ALLOWED(input.mode);

  const stateBlock = [...stateLines(input, node, allowed), input.repairRequested ? '[Ученик нажал кнопку «Не понял(а)»]' : `${LEARNER_SAID}${input.learnerText}»`].join('\n');

  const ac = new AbortController();
  const signal = input.signal ? AbortSignal.any([input.signal, ac.signal]) : ac.signal;
  const field = new JsonFieldStream('reply_el');
  const cutter = new SentenceCutter();
  const allowedWords = scenarioVocabulary(s, input.persona);
  const spoken: string[] = [];
  const fixes: string[] = [];
  const problems: string[] = [];
  let firstSentenceMs: number | null = null;
  let rejected = false;
  // Sentences are guarded in order; a rejected sentence stops the reply there (nothing unchecked is voiced).
  let chain = Promise.resolve();
  const accept = (sentence: string) => {
    chain = chain.then(async () => {
      // After a barge-in nothing more is voiced or stored: the line is what was actually said.
      if (rejected || input.signal?.aborted) return;
      const g = await guardGreek(sentence, { level: lv, allowed: allowedWords, maxWords: 40 });
      fixes.push(...g.fixes);
      if (input.signal?.aborted) return;
      if (!g.ok) { rejected = true; problems.push(...g.problems); ac.abort(); return; }
      firstSentenceMs ??= Date.now() - started;
      spoken.push(g.text);
      input.onSentence?.(g.text, spoken.length - 1);
    });
  };

  const r = await streamJson({
    userId: input.userId, operation: 'speaking_turn_stream', system: systemPrompt({ scenario: s, mode: input.mode, level: lv, persona: input.persona }),
    messages: chatMessages(input.history, stateBlock), schema: turnSchema(allowed, withHint),
    maxTokens: MAX_TOKENS[lv] ?? 160, timeoutMs: env.llmTurnTimeoutMs, temperature: 0.6, signal, cacheKey: input.sessionId,
    onText: (chunk) => { for (const sentence of cutter.push(field.push(chunk))) accept(sentence); },
  });
  if (field.complete || r.ok) for (const sentence of cutter.flush()) accept(sentence);
  await chain;

  const model = llmInfo().model ?? 'llm';
  if (!spoken.length) {
    // Nothing usable was said: the authored line of the stage keeps the scene going, labelled as fallback.
    const reason = rejected ? `GUARD:${problems.join('|')}` : r.ok ? 'EMPTY_REPLY' : r.reason;
    // Same rule as the authored engine without a model: a Greek answer advances along the main path,
    // a request for repair goes to REPAIR, anything else keeps the current step.
    const main = node.transitions.find((t) => !['REPAIR', 'RETRY'].includes(t.to))?.to;
    const target = input.repairRequested && allowed.includes('REPAIR') ? 'REPAIR'
      : !free && main && /\p{Script=Greek}{2,}/u.test(input.learnerText) ? main : node.node_id;
    return fallbackTurn(input, target, reason, started);
  }
  let out: z.infer<typeof TurnOut> | null = null;
  if (r.ok) {
    try { const parsed = TurnOut.safeParse(JSON.parse(r.text)); if (parsed.success) out = parsed.data; } catch { /* stage stays */ }
  }
  let target = out && allowed.includes(out.stage) ? out.stage : node.node_id;
  let loops = input.repairLoops;
  if (target === 'REPAIR') {
    loops += 1;
    if (loops > maxRepairs && nodeById(s, 'RETRY')) target = 'RETRY';
  }
  const targetNode = nodeById(s, target) ?? node;
  const facts = (out?.facts ?? []).map((f) => f.trim().slice(0, 90)).filter((f) => f.length > 3 && !/\p{Script=Greek}{12,}/u.test(f));
  return {
    nextNode: targetNode.node_id, assistantEl: spoken.join(' '), engine: 'llm', engineDetail: model, generated: true,
    intent: out?.intent ?? (rejected ? 'guard_truncated' : 'unparsed'), hintRu: withHint ? out?.hint_ru?.trim() || null : null,
    ended: !free && isTerminal(targetNode), repairLoops: loops, facts,
    firstSentenceMs, totalMs: Date.now() - started, guard: { fixes, problems },
  };
}

/**
 * Pre-evaluates the conversation so far in the session's KV slot (local server), so that the next
 * learner turn only has to process the learner's own words. Run while the persona speaks or the
 * learner thinks; it never produces anything the learner sees.
 */
export async function prefillConversation(p: { userId: string | null; sessionId: string; scenario: ConversationTurnInput['scenario']; mode: SpeakingMode; level: string | null; history: TurnContext[]; persona: Persona; currentNode: string | null; memory: Memory }): Promise<number | null> {
  // Only a local server that keeps the conversation's KV cache benefits; cloud APIs cache prompts themselves.
  if (!generationAllowed() || !isLocalLlm() || !(await localKvReuse())) return null;
  const started = Date.now();
  const lv = levelKey(p.level ?? p.scenario.cefr_level);
  const node = nodeById(p.scenario, p.currentNode ?? '') ?? nodeById(p.scenario, p.scenario.entry_node)!;
  // The same prompt as the next turn, cut right where the learner's words will go.
  const block = [...stateLines(p, node, allowedStages(p.scenario, node, p.mode)), LEARNER_SAID].join('\n');
  const r = await streamJson({
    userId: p.userId, operation: 'speaking_prefill', system: systemPrompt({ scenario: p.scenario, mode: p.mode, level: lv, persona: p.persona }),
    messages: chatMessages(p.history, block), schema: { type: 'object', properties: { reply_el: { type: 'string' } }, required: ['reply_el'], additionalProperties: false },
    maxTokens: 1, timeoutMs: 60_000, temperature: 0, cacheKey: p.sessionId,
  });
  return r.ok || r.reason === 'TRUNCATED' ? Date.now() - started : null;
}

let kvReuse: { at: number; value: boolean } | null = null;
/** Whether the local LLM server reuses a conversation's KV cache (see server.mjs). */
async function localKvReuse(): Promise<boolean> {
  if (kvReuse && Date.now() - kvReuse.at < 60_000) return kvReuse.value;
  try {
    const r = await fetch(`${env.llmBaseUrl!.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(1500) });
    const j = (await r.json()) as { kv_reuse?: boolean };
    kvReuse = { at: Date.now(), value: j.kv_reuse !== false };
  } catch {
    kvReuse = { at: Date.now(), value: false };
  }
  return kvReuse.value;
}

/** Merge new facts into the session memory (dedupe, newest last, bounded). */
export function mergeMemory(memory: Memory, facts: string[]): Memory {
  const all = [...memory.facts];
  for (const f of facts) if (!all.some((x) => x.toLowerCase() === f.toLowerCase())) all.push(f);
  return { facts: all.slice(-10) };
}

// ---- Feedback on the learner's phrase (non-blocking, after the reply) ---------------------------

export interface TurnFeedback {
  quote: string;
  better_el: string;
  why_ru: string;
  kind: 'error' | 'more_natural';
  source: string;
}

const FEEDBACK_SYSTEM = `Ты — внимательный преподаватель новогреческого для русскоязычных. Проверь одну реплику ученика в контексте разговора.
Найди самую важную настоящую ошибку: форма слова, согласование (род, число, падеж), глагольная форма, предлог, артикль, неверное слово, порядок слов, ударение в написании.
- quote — точный фрагмент из реплики ученика (дословно, как он написан), 1–5 слов с ошибкой.
- better_el — исправленный фрагмент на греческом (только этот фрагмент).
- why_ru — одно короткое пояснение по-русски.
- kind — "error" для ошибки; "more_natural", если ошибки нет, но есть заметно более естественный вариант.
Если реплика верна и естественна — has_issue=false. Не придирайся к пунктуации, заглавным буквам и выбору синонима, если смысл и форма верны.

Примеры:
Реплика: «Θέλω δύο κιλό πορτοκάλι.» → {"has_issue":true,"quote":"δύο κιλό πορτοκάλι","better_el":"δύο κιλά πορτοκάλια","why_ru":"После числа больше одного нужно множественное число: κιλά, πορτοκάλια.","kind":"error"}
Реплика: «Καλημέρα, θέλω ένα καφέ.» → {"has_issue":true,"quote":"ένα καφέ","better_el":"έναν καφέ","why_ru":"Ο καφές — мужской род, в винительном падеже: έναν καφέ.","kind":"error"}
Реплика: «Ένα κιλό μήλα, παρακαλώ.» → {"has_issue":false,"quote":"","better_el":"","why_ru":"","kind":"error"}`;

const FeedbackOut = z.object({ has_issue: z.boolean(), quote: z.string(), better_el: z.string(), why_ru: z.string(), kind: z.enum(['error', 'more_natural']) });
const FEEDBACK_SCHEMA = {
  type: 'object',
  properties: { has_issue: { type: 'boolean' }, quote: { type: 'string' }, better_el: { type: 'string' }, why_ru: { type: 'string' }, kind: { type: 'string', enum: ['error', 'more_natural'] } },
  required: ['has_issue', 'quote', 'better_el', 'why_ru', 'kind'], additionalProperties: false,
};

const fold = (t: string) => t.normalize('NFC').toLowerCase().replace(/[.,!?;:«»"·…]/g, '').replace(/\s+/g, ' ').trim();
/**
 * Accepted variants are not errors: accent-only differences and the optional final -ν of a few words
 * (την/τη, δεν/δε, μην/μη, αυτόν/αυτό, άλλον/άλλο as pronouns). A grammatical -ν (έναν, τον) stays.
 */
const OPTIONAL_N = new Set(['την', 'δεν', 'μην', 'αυτον', 'αλλον', 'σαν']);
const variantKey = (t: string) => fold(t).normalize('NFD').replace(/\p{M}/gu, '').split(' ').map((w) => (OPTIONAL_N.has(w) ? w.slice(0, -1) : w)).join(' ');

/**
 * Proposes one correction for a learner turn and validates it: the quote must be a verbatim part of
 * what the learner said, the better form must differ and pass the Greek guard. Returns null when the
 * model finds nothing, fails, or proposes something that does not survive validation.
 */
/** Numeral agreement the course teaches (έναν καφέ, τρία ευρώ, τρεις καφέδες, ένα ευρώ). */
export function ruleFeedback(text: string): TurnFeedback | null {
  const { fixes } = fixNumeralAgreement(text.normalize('NFC'));
  if (!fixes.length) return null;
  const [quote, better] = fixes[0].split(' → ');
  const to = better.split(' ')[0].toLowerCase();
  const why_ru = to === 'έναν'
    ? 'Существительное мужского рода в винительном падеже: «έναν» (перед гласной и κ, π, τ буква -ν обязательна).'
    : to === 'ένα'
      ? '«ευρώ» — среднего рода: «ένα ευρώ».'
      : to === 'τρία' || to === 'τέσσερα'
        ? 'Числительное согласуется с родом: «τρία», «τέσσερα» — со словами среднего рода.'
        : 'Числительное согласуется с родом: «τρεις», «τέσσερις» — со словами мужского и женского рода.';
  return { quote, better_el: better, why_ru, kind: 'error', source: 'rule:numeral-agreement' };
}

export async function feedbackOnLearnerTurn(p: { userId: string | null; sessionId: string; learnerText: string; context: string | null; level: string | null; signal?: AbortSignal; /** false: the model alone (qualification measures the model, not the rules). */ rules?: boolean }): Promise<TurnFeedback | null> {
  const text = p.learnerText.trim();
  if (!text || !/\p{Script=Greek}/u.test(text)) return null;
  // Deterministic grammar rules first: certain, instant, and labelled as a rule, not as AI.
  const rule = p.rules === false ? null : ruleFeedback(text);
  if (rule) return rule;
  if (!generationAllowed()) return null;
  const r = await streamJson({
    userId: p.userId, operation: 'speaking_feedback', system: FEEDBACK_SYSTEM,
    messages: [{ role: 'user', content: `${p.context ? `Собеседник сказал: «${p.context}»\n` : ''}Уровень ученика: ${levelKey(p.level)}.\nРеплика: «${text}»` }],
    schema: FEEDBACK_SCHEMA, maxTokens: 140, timeoutMs: Math.max(20_000, env.llmTurnTimeoutMs), temperature: 0.2, signal: p.signal, cacheKey: `${p.sessionId}:feedback`,
  });
  if (!r.ok) return null;
  let out: z.infer<typeof FeedbackOut>;
  try { const parsed = FeedbackOut.safeParse(JSON.parse(r.text)); if (!parsed.success) return null; out = parsed.data; } catch { return null; }
  if (!out.has_issue) return null;
  const quote = out.quote.trim();
  const better = out.better_el.trim();
  if (!quote || !better || !fold(text).includes(fold(quote)) || variantKey(quote) === variantKey(better)) return null;
  const g = await guardGreek(better, { level: 'B2', maxWords: 12 });
  if (!g.ok || !out.why_ru.trim()) return null;
  return { quote, better_el: g.text, why_ru: out.why_ru.trim().slice(0, 220), kind: out.kind, source: llmInfo().model ?? 'llm' };
}
