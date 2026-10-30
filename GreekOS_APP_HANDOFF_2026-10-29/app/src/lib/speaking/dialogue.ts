import { z } from 'zod';
import { env } from '../env.ts';
import { structuredCall, llmInfo } from '../providers/llm.ts';
import { greekLetterRatio } from '../scoring/normalize.ts';
import { AUTHORED_LINE_MODES, HINTS_ALLOWED, type SpeakingMode } from './state-machine.ts';

export interface ScenarioNode {
  node_id: string;
  assistant_el: string;
  learner_goal_ru?: string;
  acceptable_examples_el?: string[];
  transitions: Array<{ condition: string; to: string }>;
}

export interface ScenarioPayload {
  scenario_id: string;
  cefr_level?: string;
  domain?: string;
  learning_objective?: string;
  entry_node: string;
  nodes: ScenarioNode[];
  rubric?: Record<string, unknown>;
  off_script_policy?: { max_repair_loops?: number };
  hint_limits?: Record<string, string>;
  feedback_policy?: Record<string, string>;
  transfer_task_ru?: string;
}

export interface TurnContext {
  role: 'learner' | 'assistant';
  text: string;
}

export const DialogueOutput = z.object({
  intent: z.enum(['on_task', 'clarification_request', 'code_switch', 'counterproposal', 'off_task', 'unintelligible', 'goal_achieved']),
  transition_to: z.string(),
  assistant_el: z.string(),
  hint_ru: z.string().nullable(),
  communication_breakdown: z.boolean(),
});
export type DialogueOutput = z.infer<typeof DialogueOutput>;

export interface DialogueDecision {
  nextNode: string;
  assistantEl: string;
  intent: DialogueOutput['intent'] | 'scripted_advance' | 'repair_requested';
  hintRu: string | null;
  generated: boolean; // true = AI_DRAFT wording, not authored course content
  engine: 'llm' | 'scripted_fallback';
  ended: boolean;
  repairLoops: number;
}

export function nodeById(s: ScenarioPayload, id: string): ScenarioNode | undefined {
  return s.nodes.find((n) => n.node_id === id);
}

export function isTerminal(node: ScenarioNode | undefined): boolean {
  return !node || !node.transitions?.length;
}

const SYSTEM = `Ты ведёшь учебный ролевой диалог на новогреческом (el-GR) для русскоязычного ученика.
- Отвечай только репликой персонажа на греческом (assistant_el), коротко и естественно для уровня.
- Выбирай transition_to строго из списка допустимых переходов текущего узла (или текущий узел, если нужно уточнение).
- Оценивай смысл реплики ученика, а не дословное совпадение с примерами: примеры не являются ключом.
- Если ученик просит повторить/не понял — clarification_request и переход в REPAIR (если он есть).
- Если ученик перешёл на русский — code_switch: мягко предложи греческий вариант в hint_ru, не штрафуй.
- Не выдумывай реальных фактов (часы работы, законы); при неизвестном факте скажи, что нужно уточнить.
- hint_ru — короткая подсказка по-русски только когда она действительно помогает, иначе null.`;

/**
 * Decide the next turn. With an LLM: semantic transition classification (validated against the
 * authored graph) and, in natural modes, a generated Greek reply labelled AI_DRAFT. Without an
 * LLM: scripted advance that never assesses the learner.
 */
export async function nextTurn(params: {
  userId: string;
  scenario: ScenarioPayload;
  mode: SpeakingMode;
  currentNode: string;
  history: TurnContext[];
  learnerText: string;
  repairRequested: boolean;
  repairLoops: number;
}): Promise<DialogueDecision> {
  const { scenario } = params;
  const node = nodeById(scenario, params.currentNode) ?? nodeById(scenario, scenario.entry_node)!;
  const maxRepairs = scenario.off_script_policy?.max_repair_loops ?? 2;
  const hasRepair = !!nodeById(scenario, 'REPAIR');
  const allowed = new Set([node.node_id, ...node.transitions.map((t) => t.to)]);

  const finish = (target: string, assistantEl: string, intent: DialogueDecision['intent'], hintRu: string | null, generated: boolean, engine: DialogueDecision['engine'], repairLoops: number): DialogueDecision => {
    let to = target;
    let loops = repairLoops;
    if (to === 'REPAIR') {
      loops += 1;
      if (loops > maxRepairs && nodeById(scenario, 'RETRY')) to = 'RETRY';
    }
    const targetNode = nodeById(scenario, to) ?? node;
    // An unvalidated local model only classifies the transition: learners hear the authored line, except
    // in free talk, where no authored line exists. Generated Greek from such a model is never course text.
    const useGenerated = generated && !AUTHORED_LINE_MODES.includes(params.mode) && (!llmInfo().local || params.mode === 'free_talk');
    const line = useGenerated ? assistantEl : targetNode.assistant_el;
    return { nextNode: targetNode.node_id, assistantEl: line, intent, hintRu: HINTS_ALLOWED(params.mode) ? hintRu : null, generated: useGenerated, engine, ended: isTerminal(targetNode), repairLoops: loops };
  };

  if (params.repairRequested && hasRepair && allowed.has('REPAIR')) {
    return finish('REPAIR', '', 'repair_requested', null, false, 'scripted_fallback', params.repairLoops);
  }

  const r = await structuredCall({
    userId: params.userId,
    operation: 'speaking_turn',
    model: env.llmModelDialogue,
    system: SYSTEM,
    user: [
      `Сценарий: ${scenario.domain ?? ''} (${scenario.cefr_level ?? ''}). Цель: ${scenario.learning_objective ?? ''}. Режим: ${params.mode}.`,
      `Текущий узел ${node.node_id}. Реплика персонажа: «${node.assistant_el}». Цель ученика: ${node.learner_goal_ru ?? ''}.`,
      `Допустимые переходы:\n${node.transitions.map((t) => `- ${t.to}: ${t.condition}`).join('\n') || '- (конечный узел)'}`,
      `Примеры уместных ответов (не ключ): ${(node.acceptable_examples_el ?? []).join(' | ')}`,
      `Целевые реплики узлов:\n${node.transitions.map((t) => `${t.to}: «${nodeById(scenario, t.to)?.assistant_el ?? ''}»`).join('\n')}`,
      `История (подтверждённые реплики):\n${params.history.slice(-8).map((h) => `${h.role === 'learner' ? 'Ученик' : 'Персонаж'}: ${h.text}`).join('\n')}`,
      `Новая реплика ученика: «${params.learnerText}»`,
    ].join('\n\n'),
    schema: DialogueOutput,
    effort: 'low',
    maxTokens: 2000,
    timeoutMs: env.llmTurnTimeoutMs,
  });

  if (!r.ok) {
    // Honest fallback: follow the authored path; no assessment is derived from this turn.
    const first = node.transitions[0]?.to ?? node.node_id;
    return { ...finish(first, '', 'scripted_advance', null, false, 'scripted_fallback', params.repairLoops), engine: 'scripted_fallback' };
  }
  const out = r.data;
  const target = allowed.has(out.transition_to) ? out.transition_to : node.node_id;
  const greekOk = greekLetterRatio(out.assistant_el) >= 0.6 && out.assistant_el.trim().length > 0;
  return finish(target, greekOk ? out.assistant_el.trim() : '', out.intent, out.hint_ru, greekOk, 'llm', params.repairLoops);
}

/** Session summary schema: evidence must cite real confirmed learner turn IDs, else ABSTAIN. */
export const SessionSummaryOutput = z.object({
  decision: z.enum(['ASSESSED', 'ABSTAIN']),
  communicative_goal: z.enum(['achieved', 'partially', 'not_achieved', 'unclear']),
  dimensions: z.array(z.object({ dimension: z.enum(['task_success', 'interaction', 'language', 'register']), level: z.enum(['independent', 'with_help', 'not_demonstrated', 'not_assessable']), evidence_turn_ids: z.array(z.string()), note_ru: z.string() })),
  corrections: z.array(z.object({ turn_id: z.string(), quote: z.string(), better_el: z.string(), why_ru: z.string(), kind: z.enum(['confirmed_error', 'style_suggestion']) })),
  used_constructions_el: z.array(z.string()),
  next_step_ru: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
  abstain_reason: z.string().nullable(),
});
export type SessionSummaryOutput = z.infer<typeof SessionSummaryOutput>;

export function validateSummary(out: SessionSummaryOutput, learnerTurns: Array<{ turn_id: string; text: string }>): { ok: true } | { ok: false; reason: string } {
  const byId = new Map(learnerTurns.map((t) => [t.turn_id, t.text.normalize('NFC')]));
  for (const d of out.dimensions) for (const id of d.evidence_turn_ids) if (!byId.has(id)) return { ok: false, reason: 'UNKNOWN_TURN_REFERENCE' };
  for (const c of out.corrections) {
    const t = byId.get(c.turn_id);
    if (!t || !c.quote.trim() || !t.includes(c.quote.normalize('NFC'))) return { ok: false, reason: 'HALLUCINATED_QUOTE' };
  }
  if (out.corrections.length > 3) return { ok: false, reason: 'TOO_MANY_CORRECTIONS' };
  return { ok: true };
}

export async function summarizeSession(params: { userId: string; scenario: ScenarioPayload; mode: SpeakingMode; turns: Array<{ turn_id: string; speaker: string; text: string; confirmed: boolean }> }) {
  const learnerTurns = params.turns.filter((t) => t.speaker === 'learner' && t.confirmed).map((t) => ({ turn_id: t.turn_id, text: t.text }));
  if (learnerTurns.length < 2) return { ok: false as const, reason: 'INSUFFICIENT_TURNS' };
  const r = await structuredCall({
    userId: params.userId, operation: 'speaking_summary', model: env.llmModelAssessor,
    system: `Ты подводишь итог учебного диалога на греческом. Оценивай только подтверждённые реплики ученика по рубрике сценария. Произношение не оценивай (not_assessable). Ссылайся на turn_id реальных реплик, цитаты — дословные подстроки. Максимум 3 исправления, сначала смысл. Это учебная автоматическая оценка, не официальный экзамен. При сомнении — ABSTAIN.`,
    user: [
      `Сценарий ${params.scenario.scenario_id}: ${params.scenario.learning_objective ?? ''}; режим ${params.mode}.`,
      `Рубрика: ${JSON.stringify(params.scenario.rubric ?? {})}`,
      `Диалог:\n${params.turns.map((t) => `[${t.turn_id}] ${t.speaker === 'learner' ? 'Ученик' : 'Персонаж'}${t.confirmed ? '' : ' (не подтверждено)'}: ${t.text}`).join('\n')}`,
    ].join('\n\n'),
    schema: SessionSummaryOutput, effort: 'medium', maxTokens: 8000, timeoutMs: 60_000,
  });
  if (!r.ok) return { ok: false as const, reason: r.reason };
  if (r.data.decision === 'ABSTAIN') return { ok: false as const, reason: r.data.abstain_reason ?? 'MODEL_ABSTAINED' };
  const v = validateSummary(r.data, learnerTurns);
  if (!v.ok) return { ok: false as const, reason: v.reason };
  return { ok: true as const, summary: r.data, model: r.model };
}
