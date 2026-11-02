/**
 * GreekOS speaking evaluation: runs the conversation engine on the configured LLM over the case suite
 * (real corpus scenarios), measures what a learner would get, writes a report and — for a local
 * model — its qualification record (local-services/llm/qualification.json).
 *
 *   npx tsx scripts/speaking-eval.ts [--out reports/v6/speaking-eval] [--only id,id] [--no-qualify]
 *
 * Thresholds are deliberately strict for what a learner hears (no fallback, no echoed errors, no
 * Russian), and strict on precision for corrections (a wrong correction is worse than none).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { adminClient } from '../src/lib/supabase/admin.ts';
import { env } from '../src/lib/env.ts';
import { isLocalLlm, llmInfo } from '../src/lib/providers/llm.ts';
import { conversationTurn, feedbackOnLearnerTurn, prefillConversation, CONVERSATION_ENGINE_VERSION } from '../src/lib/speaking/conversation.ts';
import { greekWords } from '../src/lib/speaking/greek-guard.ts';
import type { ScenarioPayload } from '../src/lib/speaking/dialogue.ts';
import { CASES, SUITE, type EvalCase } from './speaking-eval.cases.ts';

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const outDir = arg('--out') ?? 'reports/v6/speaking-eval';
const only = arg('--only')?.split(',');
const qualify = !process.argv.includes('--no-qualify');

const THRESHOLDS = { reply_ok: 0.9, stage_ok: 0.7, echo_violations: 0, russian_or_latin: 0, feedback_precision: 0.75, feedback_recall: 0.5, question_ok: 0.75 };
const fold = (t: string) => t.normalize('NFC').toLowerCase();
const pct = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0; };

async function main() {
  process.env.APP_ENV ??= 'local';
  const info = llmInfo();
  if (info.provider === 'none') throw new Error('LLM is not configured (LLM_PROVIDER / LLM_BASE_URL)');
  // The evaluation must be able to run before the model is qualified.
  process.env.GREEKOS_EVAL_FORCE_GENERATION = '1';
  const ids = [...new Set(CASES.map((c) => c.scenario))];
  const { data } = await adminClient().from('speaking_scenarios').select('scenario_id, level, payload').in('scenario_id', ids);
  const scen = new Map((data ?? []).map((r) => [r.scenario_id, { level: r.level as string, payload: r.payload as ScenarioPayload }]));
  const rows: Array<Record<string, unknown>> = [];
  for (const c of CASES.filter((x) => !only || only.includes(x.id))) rows.push(await runCase(c, scen.get(c.scenario)!));

  const n = rows.length;
  const rate = (k: string) => rows.filter((r) => r[k] === true).length / Math.max(1, rows.filter((r) => r[k] !== null).length);
  const fbIssue = rows.filter((r) => r.feedback_expect === 'issue');
  const fbGiven = rows.filter((r) => r.feedback_expect !== 'skip' && r.feedback);
  const fbCorrect = fbGiven.filter((r) => r.feedback_expect === 'issue' && r.feedback_ok);
  const metrics = {
    reply_ok: rate('reply_ok'),
    stage_ok: rate('stage_ok'),
    echo_violations: rows.filter((r) => r.echo_ok === false).length,
    russian_or_latin: rows.filter((r) => r.foreign === true).length,
    question_ok: rate('question_ok'),
    length_ok: rate('length_ok'),
    memory_ok: rate('memory_ok'),
    no_hint_ok: rate('no_hint_ok'),
    feedback_precision: fbGiven.length ? fbCorrect.length / fbGiven.length : 1,
    feedback_recall: fbIssue.length ? fbIssue.filter((r) => r.feedback_ok).length / fbIssue.length : 1,
    first_sentence_p50_ms: pct(rows.map((r) => Number(r.first_ms ?? 0)).filter(Boolean), 0.5),
    first_sentence_p95_ms: pct(rows.map((r) => Number(r.first_ms ?? 0)).filter(Boolean), 0.95),
    turn_p50_ms: pct(rows.map((r) => Number(r.total_ms)), 0.5),
    feedback_p50_ms: pct(rows.map((r) => Number(r.feedback_ms ?? 0)).filter(Boolean), 0.5),
  };
  const dialogue_passed = metrics.reply_ok >= THRESHOLDS.reply_ok && metrics.stage_ok >= THRESHOLDS.stage_ok && metrics.echo_violations <= THRESHOLDS.echo_violations && metrics.russian_or_latin <= THRESHOLDS.russian_or_latin && metrics.question_ok >= THRESHOLDS.question_ok;
  const feedback_passed = metrics.feedback_precision >= THRESHOLDS.feedback_precision && metrics.feedback_recall >= THRESHOLDS.feedback_recall;
  const model = info.model ?? 'unknown';
  const report = { suite: SUITE, engine: CONVERSATION_ENGINE_VERSION, model, provider: info.provider, local: isLocalLlm(), evaluated_at: new Date().toISOString(), cases: n, thresholds: THRESHOLDS, metrics, dialogue_passed, feedback_passed, rows };
  mkdirSync(outDir, { recursive: true });
  const base = join(outDir, `${model}`);
  writeFileSync(`${base}.json`, JSON.stringify(report, null, 2));
  writeFileSync(`${base}.md`, markdown(report));
  if (qualify && isLocalLlm() && !only) {
    const file = resolve('local-services/llm/qualification.json');
    const all = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
    all[model] = {
      model, suite: SUITE, engine: CONVERSATION_ENGINE_VERSION, evaluated_at: report.evaluated_at, cases: n, passed: dialogue_passed, feedback_passed,
      metrics, thresholds: THRESHOLDS, report: `${base}.md`,
      note_ru: 'Автоматическая проверка набором GreekOS (разметка разработчика по грамматике). Не экспертная и не носительская оценка.',
    };
    writeFileSync(file, `${JSON.stringify(all, null, 2)}\n`);
  }
  console.log(JSON.stringify({ model, cases: n, dialogue_passed, feedback_passed, metrics }, null, 2));
}

async function runCase(c: EvalCase, sc: { level: string; payload: ScenarioPayload }) {
  const s = sc.payload;
  const node = c.node ?? s.entry_node;
  const opening = c.mode === 'free_talk' ? 'Γεια σου! Τι κάνεις; Πώς πάει η μέρα σου;' : s.nodes.find((x) => x.node_id === s.entry_node)!.assistant_el;
  const history = [{ role: 'assistant' as const, text: opening }, ...(c.history ?? []).map(([w, t]) => ({ role: w === 'a' ? 'assistant' as const : 'learner' as const, text: t }))];
  const sentences: Array<{ t: number; s: string }> = [];
  // As in a live session: the conversation so far is pre-evaluated while the persona speaks.
  const prefillMs = process.env.GREEKOS_EVAL_NO_PREFILL === '1' ? null : await prefillConversation({ userId: null, sessionId: `eval-${c.id}`, scenario: s, mode: c.mode, level: c.level ?? sc.level, history, persona: { name: 'Ελένη', presentation: 'female' } });
  const t0 = Date.now();
  const turn = await conversationTurn({
    userId: null, sessionId: `eval-${c.id}`, scenario: s, mode: c.mode, level: c.level ?? sc.level, currentNode: node,
    history, learnerText: c.learner, repairRequested: false, repairLoops: 0, memory: { facts: c.facts ?? [] },
    persona: { name: 'Ελένη', presentation: 'female' }, onSentence: (x) => sentences.push({ t: Date.now() - t0, s: x }),
  });
  const f0 = Date.now();
  const fb = c.expect.feedback === 'skip' ? null : await feedbackOnLearnerTurn({ userId: null, sessionId: `eval-${c.id}`, learnerText: c.learner, context: history.at(-1)?.text ?? null, level: c.level ?? sc.level });
  const feedbackMs = c.expect.feedback === 'skip' ? null : Date.now() - f0;
  const reply = turn.assistantEl;
  const e = c.expect;
  const words = greekWords(reply).length;
  const row = {
    id: c.id, scenario: c.scenario, mode: c.mode, learner: c.learner, reply, engine: turn.engine, engine_detail: turn.engineDetail, stage: turn.nextNode, intent: turn.intent, hint_ru: turn.hintRu, facts: turn.facts,
    prefill_ms: prefillMs, first_ms: turn.firstSentenceMs, total_ms: turn.totalMs, sentences: sentences.length, guard: turn.guard,
    reply_ok: turn.engine === 'llm',
    stage_ok: e.stages ? e.stages.includes(turn.nextNode) : null,
    echo_ok: e.reply_not ? !e.reply_not.some((x) => fold(reply).includes(fold(x))) : null,
    foreign: /\p{Script=Cyrillic}|[A-Za-z]{3,}/u.test(reply),
    question_ok: e.question ? /[;?]/.test(reply) : null,
    length_ok: e.max_words ? words <= e.max_words : null,
    memory_ok: e.reply_any ? e.reply_any.some((x) => fold(reply).includes(fold(x))) : null,
    no_hint_ok: e.no_hint ? !turn.hintRu : null,
    feedback_expect: e.feedback,
    feedback: fb,
    feedback_ok: e.feedback === 'skip' ? null : e.feedback === 'none' ? !fb : !!fb && (!e.better_any || e.better_any.some((x) => fold(fb.better_el).includes(fold(x)))),
    feedback_ms: feedbackMs,
  };
  console.log(`${c.id}: ${row.engine} stage=${row.stage} ${row.stage_ok === false ? '✗' : ''} | ${reply} | fb=${fb ? `${fb.quote} → ${fb.better_el}` : '—'} ${row.feedback_ok === false ? '✗' : ''} | ${row.first_ms}ms/${row.total_ms}ms`);
  return row;
}

function markdown(r: { model: string; suite: string; engine: string; evaluated_at: string; cases: number; metrics: Record<string, number>; thresholds: Record<string, number>; dialogue_passed: boolean; feedback_passed: boolean; rows: Array<Record<string, unknown>> }) {
  const m = r.metrics;
  const yes = (b: unknown) => (b === null ? '—' : b ? '✓' : '✗');
  return [
    `# Оценка AI-собеседника: ${r.model}`,
    '',
    `Набор \`${r.suite}\`, движок \`${r.engine}\`, ${r.evaluated_at}. Случаев: ${r.cases}. Разметка — разработчика по грамматике, не носителя; это проверка движка, а не сертификация языка.`,
    '',
    `**Диалог: ${r.dialogue_passed ? 'ПРОЙДЕНО' : 'НЕ ПРОЙДЕНО'}** · **Исправления: ${r.feedback_passed ? 'ПРОЙДЕНО' : 'НЕ ПРОЙДЕНО'}**`,
    '',
    '| Метрика | Значение | Порог |',
    '|---|---|---|',
    `| Реплика AI без запасного сценария | ${(m.reply_ok * 100).toFixed(0)}% | ≥ ${r.thresholds.reply_ok * 100}% |`,
    `| Верный этап сцены | ${(m.stage_ok * 100).toFixed(0)}% | ≥ ${r.thresholds.stage_ok * 100}% |`,
    `| Повтор ошибки ученика в ответе | ${m.echo_violations} | ${r.thresholds.echo_violations} |`,
    `| Русский/латиница в ответе | ${m.russian_or_latin} | ${r.thresholds.russian_or_latin} |`,
    `| Вопрос в свободном разговоре | ${(m.question_ok * 100).toFixed(0)}% | ≥ ${r.thresholds.question_ok * 100}% |`,
    `| Память фактов | ${(m.memory_ok * 100).toFixed(0)}% | — |`,
    `| Точность исправлений | ${(m.feedback_precision * 100).toFixed(0)}% | ≥ ${r.thresholds.feedback_precision * 100}% |`,
    `| Полнота исправлений | ${(m.feedback_recall * 100).toFixed(0)}% | ≥ ${r.thresholds.feedback_recall * 100}% |`,
    `| Первое предложение p50 / p95 | ${m.first_sentence_p50_ms} / ${m.first_sentence_p95_ms} мс | — |`,
    `| Ход целиком p50 | ${m.turn_p50_ms} мс | — |`,
    `| Разбор фразы p50 (после ответа) | ${m.feedback_p50_ms} мс | — |`,
    '',
    '| Случай | Ученик | Ответ | Этап | Исправление | Время |',
    '|---|---|---|---|---|---|',
    ...r.rows.map((x) => {
      const fb = x.feedback as { quote: string; better_el: string } | null;
      return `| ${x.id} | ${x.learner} | ${x.engine === 'llm' ? '' : '⚠ запасная: '}${x.reply} | ${x.stage} ${yes(x.stage_ok)} | ${fb ? `${fb.quote} → ${fb.better_el}` : '—'} ${yes(x.feedback_ok)} | ${x.first_ms ?? '—'}/${x.total_ms} мс |`;
    }),
    '',
  ].join('\n');
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
