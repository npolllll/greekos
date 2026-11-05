/**
 * Content QA per lesson: the digital checks of the lesson and its items (latest run on the CURRENT
 * hash of each object), laid out along the dimensions an owner decides on — completeness, Greek,
 * answers, error explanations, CEFR fit, learning logic, Russian theory, rights and audio.
 *
 * Everything here is automatic (scripts and rules). It is never a teacher's or native speaker's
 * review: the `human` dimension always says so.
 */
import { adminClient, selectAll } from '../supabase/admin.ts';
import { releaseMap } from '../content/repo.ts';

export type DimensionId = 'completeness' | 'language' | 'answers' | 'explanations' | 'cefr' | 'logic' | 'theory' | 'rights' | 'audio' | 'human';
export type DimensionStatus = 'ok' | 'warn' | 'block' | 'not_done';
export interface Dimension { id: DimensionId; title_ru: string; status: DimensionStatus; notes: string[] }
export type LessonSummary = 'READY_FOR_OWNER' | 'NEEDS_FIX' | 'NOT_CHECKED_CURRENT';
export interface LessonQa {
  unit_id: string; level: string; title_ru: string; sort_key: number; current_hash: string;
  released: boolean;
  checked_at: string | null;
  items_total: number;
  sections: Record<string, number>;
  verdicts: Record<'PASS' | 'NEEDS_REVIEW' | 'FAIL' | 'ABSTAIN' | 'NOT_CHECKED', number>;
  open_issues: { blocking: number; warning: number; info: number };
  owner_sample: { ok: number; issue: number };
  dimensions: Dimension[];
  summary: LessonSummary;
  summary_ru: string;
  /** Up to 12 open blocking/warning findings, most severe first. */
  top_issues: Array<{ object: string; check_id: string; severity: string; message_ru: string }>;
}

export const DIMENSION_TITLE: Record<DimensionId, string> = {
  completeness: 'Полнота и структура',
  language: 'Греческий: орфография и норма',
  answers: 'Ответы и ключи',
  explanations: 'Объяснения ошибок',
  cefr: 'Соответствие уровню CEFR',
  logic: 'Логика обучения',
  theory: 'Теория на русском',
  rights: 'Права на материал',
  audio: 'Аудио',
  human: 'Проверка преподавателем / носителем',
};
export const SUMMARY_RU: Record<LessonSummary, string> = {
  READY_FOR_OWNER: 'Цифровая проверка без блокирующих замечаний — можно принимать решение о выпуске',
  NEEDS_FIX: 'Есть блокирующие замечания или вердикт FAIL — выпуск невозможен до исправления',
  NOT_CHECKED_CURRENT: 'Текущая версия урока или части заданий ещё не проверялась — запустите цифровой QA',
};

const PREFIX: Array<[string, DimensionId]> = [
  ['ortho.', 'language'], ['keys.', 'answers'], ['scoring.', 'answers'], ['level.', 'cefr'],
  ['schema.', 'completeness'], ['refs.', 'completeness'], ['hash.', 'completeness'],
  ['rights.', 'rights'], ['modality.audio', 'audio'], ['modality.', 'completeness'], ['sources.', 'rights'],
];
const dimensionOf = (checkId: string): DimensionId | null => {
  if (checkId === 'human.review') return null;
  return PREFIX.find(([p]) => checkId.startsWith(p))?.[1] ?? 'completeness';
};
const CYR = /[А-Яа-яЁё]/g;
const cyrShare = (s: string) => { const letters = s.match(/\p{L}/gu)?.length ?? 0; return letters ? (s.match(CYR)?.length ?? 0) / letters : 0; };
// Separates a single quoted sentence from connected input; short genres (a full notice of ~45 words) count.
const MIN_READING_WORDS: Record<string, number> = { A1: 20, A2: 30, B1: 40, B2: 60 };
const GREEK_WORD = /[\u0370-\u03ff\u1f00-\u1fff]+/gu;
const greekWords = (i: { envelope: { prompt?: string; stimulus?: unknown } }) => {
  const st = i.envelope.stimulus;
  const text = `${typeof st === 'string' ? st : st && typeof st === 'object' ? Object.values(st as Record<string, unknown>).filter((v) => typeof v === 'string').join(' ') : ''} ${i.envelope.prompt ?? ''}`;
  return text.match(GREEK_WORD)?.length ?? 0;
};
// Lesson stages as items declare them (items.section); each group must be present.
const STAGES: Array<{ ru: string; sections: string[] }> = [
  { ru: 'управляемая практика', sections: ['guided_practice'] },
  { ru: 'восприятие (чтение или аудирование)', sections: ['reading', 'listening'] },
  { ru: 'продукция (письмо, речь или перенос)', sections: ['writing', 'speaking', 'transfer'] },
  { ru: 'закрепление (повторение или активное припоминание)', sections: ['retention', 'active_recall'] },
];

type UnitRow = { unit_id: string; level: string; title_ru: string; sort_key: number; current_hash: string; competency_ids: string[]; primary_competencies: string[]; teaching: Record<string, unknown> };
type ItemRow = { item_id: string; unit_id: string; item_type: string; level: string | null; section: string | null; pool: string | null; requires_audio: boolean; scoring_strategy: string; competency_ids: string[]; audio_job_ids: string[]; error_tags: string[] | null; current_hash: string; envelope: { prompt?: string; stimulus?: unknown; original_payload?: { rationale?: unknown }; answer_explanation_ru?: string | null } };
type ResultRow = { batch_id: string; content_kind: string; content_id: string; content_hash: string; verdict: string };
type IssueRow = { batch_id: string; content_kind: string; content_id: string; content_hash: string; check_id: string; severity: string; message_ru: string; status: string };

export async function buildLessonQa(opts: { unitIds?: string[] } = {}): Promise<LessonQa[]> {
  const db = adminClient();
  const allUnits = await selectAll<UnitRow>((f, t) => db.from('units').select('unit_id, level, title_ru, sort_key, current_hash, competency_ids, primary_competencies, teaching').order('sort_key').range(f, t));
  // Synthetic test fixtures (SYN-…) are never course lessons, as in the release scope.
  const units = (opts.unitIds ? allUnits.filter((u) => opts.unitIds!.includes(u.unit_id)) : allUnits).filter((u) => !u.unit_id.startsWith('SYN-'));
  if (!units.length) return [];
  const unitIds = units.map((u) => u.unit_id);
  const items = await selectAll<ItemRow>((f, t) => db.from('items').select('item_id, unit_id, item_type, level, section, pool, requires_audio, scoring_strategy, competency_ids, audio_job_ids, error_tags, current_hash, envelope').in('unit_id', unitIds).order('item_id').range(f, t));
  const { data: batches } = await db.from('qa_batches').select('id, finished_at, scope').eq('status', 'COMPLETED').order('finished_at', { ascending: false });
  const contentBatches = (batches ?? []).filter((b) => (b.scope as { kind?: string })?.kind !== 'audio');
  const finished = new Map(contentBatches.map((b) => [b.id as string, b.finished_at as string]));
  // Latest full run plus any later targeted re-checks are enough to cover every current hash.
  const lastAll = contentBatches.findIndex((b) => (b.scope as { kind?: string })?.kind === 'all');
  const useBatches = contentBatches.slice(0, lastAll === -1 ? contentBatches.length : lastAll + 1).map((b) => b.id as string);
  const objectIds = [...unitIds, ...items.map((i) => i.item_id)];
  const results: ResultRow[] = [];
  const issues: IssueRow[] = [];
  for (let i = 0; i < objectIds.length; i += 300) {
    const chunk = objectIds.slice(i, i + 300);
    if (!useBatches.length) break;
    results.push(...await selectAll<ResultRow>((f, t) => db.from('qa_item_results').select('batch_id, content_kind, content_id, content_hash, verdict').in('batch_id', useBatches).in('content_kind', ['unit', 'item']).in('content_id', chunk).range(f, t)));
    issues.push(...await selectAll<IssueRow>((f, t) => db.from('qa_issues').select('batch_id, content_kind, content_id, content_hash, check_id, severity, message_ru, status').in('batch_id', useBatches).in('content_kind', ['unit', 'item']).in('content_id', chunk).range(f, t)));
  }
  const latest = new Map<string, ResultRow>();
  for (const r of results) {
    const key = `${r.content_kind}|${r.content_id}|${r.content_hash}`;
    const cur = latest.get(key);
    if (!cur || (finished.get(r.batch_id) ?? '') > (finished.get(cur.batch_id) ?? '')) latest.set(key, r);
  }
  const resultFor = (kind: string, id: string, hash: string) => latest.get(`${kind}|${id}|${hash}`) ?? null;
  // Owner sample reviews are few (≤ 30 per decision): read them all, count those on current hashes.
  const samples = await selectAll<{ content_id: string; content_hash: string; decision: string }>((f, t) => db.from('qa_sample_reviews').select('content_id, content_hash, decision').in('content_kind', ['unit', 'item']).range(f, t));
  const released = await releaseMap('unit', units.map((u) => ({ id: u.unit_id, hash: u.current_hash })));
  const { data: jobs } = await db.from('audio_job_render_status').select('audio_id, status');
  const jobStatus = new Map((jobs ?? []).map((j) => [j.audio_id as string, j.status as string]));
  // Where each competency is first taught (for prerequisite order).
  const firstTaught = new Map<string, number>();
  for (const u of allUnits) for (const c of u.primary_competencies.length ? u.primary_competencies : u.competency_ids) if (!firstTaught.has(c) || firstTaught.get(c)! > u.sort_key) firstTaught.set(c, u.sort_key);

  return units.map((u) => {
    const its = items.filter((i) => i.unit_id === u.unit_id);
    const t = u.teaching as { theory_ru?: string; examples_el?: unknown[]; learning_objectives?: unknown[]; errors_taxonomy?: string[]; prerequisites?: string[]; review_plan?: unknown; active_recall?: unknown[]; sections?: Record<string, unknown> };
    const unitRes = resultFor('unit', u.unit_id, u.current_hash);
    const itemRes = its.map((i) => ({ i, r: resultFor('item', i.item_id, i.current_hash) }));
    const verdicts: LessonQa['verdicts'] = { PASS: 0, NEEDS_REVIEW: 0, FAIL: 0, ABSTAIN: 0, NOT_CHECKED: 0 };
    for (const { r } of itemRes) verdicts[(r?.verdict ?? 'NOT_CHECKED') as keyof typeof verdicts]++;
    const chosen = [...(unitRes ? [unitRes] : []), ...itemRes.flatMap(({ r }) => (r ? [r] : []))];
    const open = issues.filter((x) => chosen.some((r) => r.batch_id === x.batch_id && r.content_id === x.content_id && r.content_hash === x.content_hash && r.content_kind === x.content_kind)
      && !['fixed', 'false_positive', 'accepted_risk'].includes(x.status) && x.check_id !== 'human.review');
    const dims = new Map<DimensionId, Dimension>((Object.keys(DIMENSION_TITLE) as DimensionId[]).map((id) => [id, { id, title_ru: DIMENSION_TITLE[id], status: 'ok', notes: [] }]));
    const flag = (id: DimensionId, status: Exclude<DimensionStatus, 'ok'>, note: string) => {
      const d = dims.get(id)!;
      const rank = { ok: 0, not_done: 1, warn: 2, block: 3 } as const;
      if (rank[status] > rank[d.status]) d.status = status;
      if (d.notes.length < 6) d.notes.push(note);
    };
    const note = (id: DimensionId, text: string) => { const d = dims.get(id)!; if (d.notes.length < 6) d.notes.push(text); };
    for (const x of open) {
      const d = dimensionOf(x.check_id);
      if (!d) continue;
      if (x.severity === 'blocking') flag(d, 'block', `${x.content_id}: ${x.message_ru}`);
      else if (x.severity === 'warning') flag(d, 'warn', `${x.content_id}: ${x.message_ru}`);
    }
    // Completeness and structure.
    const sections: Record<string, number> = {};
    for (const i of its) sections[i.section ?? 'без раздела'] = (sections[i.section ?? 'без раздела'] ?? 0) + 1;
    if (!its.length) flag('completeness', 'block', 'В уроке нет заданий.');
    // Reception counts when the plan names the task (reading_tasks / listening_tasks) even if its section is
    // «guided practice»; a reading task must give connected input of the lesson's level, not one sentence.
    const planned = new Set([...((t as { reading_tasks?: string[] }).reading_tasks ?? []), ...((t as { listening_tasks?: string[] }).listening_tasks ?? [])]);
    const reception = its.filter((i) => ['reading', 'listening'].includes(i.section ?? '') || planned.has(i.item_id));
    const listening = reception.filter((i) => i.section === 'listening' || i.requires_audio || i.audio_job_ids.length || ((t as { listening_tasks?: string[] }).listening_tasks ?? []).includes(i.item_id));
    const longest = Math.max(0, ...reception.map((i) => greekWords(i)));
    for (const st of STAGES) {
      if (st.sections.includes('reading')) {
        if (!reception.length) flag('completeness', 'warn', 'Нет этапа «восприятие (чтение или аудирование)».');
        else if (!listening.length && longest < (MIN_READING_WORDS[u.level] ?? 40)) flag('completeness', 'warn', `Восприятие только по отдельным фразам: самый длинный греческий текст ${longest} слов (для ${u.level} нужен связный текст от ${MIN_READING_WORDS[u.level] ?? 40}).`);
      } else if (!st.sections.some((x) => sections[x])) flag('completeness', 'warn', `Нет этапа «${st.ru}».`);
    }
    const notChecked = itemRes.filter(({ r }) => !r).length + (unitRes ? 0 : 1);
    // Explanations: every scored, non-diagnostic item explains the right answer in Russian.
    const needExpl = its.filter((i) => i.pool !== 'diagnostic_holdout' && i.section !== 'diagnostic');
    const list = (xs: ItemRow[]) => `${xs.slice(0, 5).map((i) => i.item_id).join(', ')}${xs.length > 5 ? ` и ещё ${xs.length - 5}` : ''}`;
    // What the learner reads after answering: the Russian explanation revision, else the author's rationale.
    const rationale = (i: ItemRow) => (i.envelope.answer_explanation_ru?.trim() || (typeof i.envelope.original_payload?.rationale === 'string' ? i.envelope.original_payload.rationale.trim() : ''));
    const noExpl = needExpl.filter((i) => !rationale(i));
    if (noExpl.length) flag('explanations', noExpl.length > needExpl.length / 4 ? 'block' : 'warn', `Нет объяснения: ${list(noExpl)}.`);
    const greekOnly = needExpl.filter((i) => rationale(i) && cyrShare(rationale(i)) < 0.3);
    if (greekOnly.length) flag('explanations', 'warn', `Объяснение только на греческом (${greekOnly.length} из ${needExpl.length}): ${list(greekOnly)}. Для ${u.level} допустимо, но русскоязычному ученику может быть непонятно.`);
    const taxonomy = new Set(t.errors_taxonomy ?? []);
    // Keyed items without an error tag still get the explanation; only the notebook's grouping is generic.
    const untagged = needExpl.filter((i) => !(i.error_tags ?? []).length && i.scoring_strategy !== 'REVIEW_REQUIRED');
    if (untagged.length) note('explanations', `${untagged.length} заданий с ключом без тега типичной ошибки: разбор есть, в тетради ошибок они группируются как «прочее».`);
    const foreignTags = [...new Set(its.flatMap((i) => i.error_tags ?? []).filter((x) => taxonomy.size && !taxonomy.has(x)))];
    // Tags are stored with errors but not shown to learners: a metadata mismatch, not a teaching defect.
    if (foreignTags.length) note('explanations', `Метаданные: теги ошибок вне таксономии урока (ученику не показываются): ${foreignTags.slice(0, 4).join(', ')}.`);
    // CEFR fit: item levels agree with the lesson (level.* findings above cover text length).
    const offLevel = its.filter((i) => i.level && i.level !== u.level);
    if (offLevel.length) flag('cefr', 'warn', `Уровень задания не совпадает с уроком (${u.level}): ${offLevel.slice(0, 4).map((i) => `${i.item_id} ${i.level}`).join(', ')}.`);
    // Learning logic: prerequisites are taught earlier; the lesson's main competencies are practised.
    const late = (t.prerequisites ?? []).filter((c) => firstTaught.has(c) && firstTaught.get(c)! >= u.sort_key);
    if (late.length) flag('logic', 'warn', `Предпосылки вводятся не раньше этого урока: ${late.join(', ')}.`);
    const practised = new Set(its.flatMap((i) => i.competency_ids));
    const unpractised = u.primary_competencies.filter((c) => !practised.has(c));
    if (unpractised.length) flag('logic', 'warn', `Основные компетенции без заданий: ${unpractised.join(', ')}.`);
    if (!t.review_plan && !(t.active_recall ?? []).length) flag('logic', 'warn', 'Нет плана повторения и активного припоминания.');
    // Russian theory.
    const theory = String(t.theory_ru ?? '');
    if (theory.length < 300) flag('theory', theory ? 'warn' : 'block', theory ? `Теория короткая (${theory.length} знаков).` : 'Нет теории на русском.');
    else if (cyrShare(theory) < 0.5) flag('theory', 'warn', 'Теория написана не преимущественно по-русски.');
    if (!(t.examples_el ?? []).length) flag('theory', 'warn', 'Нет греческих примеров к теории.');
    if (!(t.learning_objectives ?? []).length) flag('theory', 'warn', 'Не указаны цели урока.');
    if (unitRes) for (const x of open.filter((o) => o.content_kind === 'unit' && o.check_id.startsWith('ortho.'))) flag('theory', x.severity === 'blocking' ? 'block' : 'warn', `Греческие слова в тексте урока: ${x.message_ru}`);
    // Audio.
    const audioItems = its.filter((i) => i.requires_audio);
    if (audioItems.length) {
      const jobIds = [...new Set(audioItems.flatMap((i) => i.audio_job_ids))];
      const ready = jobIds.filter((j) => jobStatus.get(j) === 'RELEASE_ELIGIBLE').length;
      flag('audio', 'not_done', `${audioItems.length} заданий на слух; аудио готово к выпуску: ${ready} из ${jobIds.length}. Без него эти задания остаются закрытыми, урок проходится без них.`);
    }
    dims.get('human')!.status = 'not_done';
    dims.get('human')!.notes.push('Не проводилась. Все оценки выше — автоматические.');
    const blocking = open.filter((x) => x.severity === 'blocking').length;
    const summary: LessonSummary = notChecked ? 'NOT_CHECKED_CURRENT'
      : blocking || verdicts.FAIL || [...dims.values()].some((d) => d.status === 'block') ? 'NEEDS_FIX' : 'READY_FOR_OWNER';
    const current = new Map([[u.unit_id, u.current_hash], ...its.map((i) => [i.item_id, i.current_hash] as [string, string])]);
    const sample = samples.filter((s) => current.get(s.content_id) === s.content_hash);
    const sev = { blocking: 0, warning: 1, info: 2 } as Record<string, number>;
    return {
      unit_id: u.unit_id, level: u.level, title_ru: u.title_ru, sort_key: u.sort_key, current_hash: u.current_hash,
      released: released.has(u.unit_id),
      checked_at: chosen.map((r) => finished.get(r.batch_id) ?? '').sort().pop() || null,
      items_total: its.length, sections, verdicts,
      open_issues: { blocking, warning: open.filter((x) => x.severity === 'warning').length, info: open.filter((x) => x.severity === 'info').length },
      owner_sample: { ok: sample.filter((s) => s.decision === 'OK').length, issue: sample.filter((s) => s.decision === 'ISSUE').length },
      dimensions: [...dims.values()],
      summary, summary_ru: SUMMARY_RU[summary],
      top_issues: open.filter((x) => x.severity !== 'info').sort((a, b) => sev[a.severity] - sev[b.severity]).slice(0, 12).map((x) => ({ object: x.content_id, check_id: x.check_id, severity: x.severity, message_ru: x.message_ru })),
    };
  });
}

const MARK: Record<DimensionStatus, string> = { ok: '✅', warn: '⚠️', block: '⛔', not_done: '—' };

/** Markdown for the repository report (one table + details per lesson). */
export function lessonQaMarkdown(rows: LessonQa[], at: string): string {
  const dimIds = Object.keys(DIMENSION_TITLE) as DimensionId[];
  const count = (s: LessonSummary) => rows.filter((r) => r.summary === s).length;
  const out = [
    `# Содержательная проверка по урокам — ${at}`, '',
    'Автоматическая (цифровая) проверка: правила, словарь hunspell el_GR, ключи, структура, уровень, права, аудио.',
    '**Это не проверка преподавателем или носителем языка** — такая проверка не проводилась.', '',
    `Уроков: ${rows.length}. Без блокирующих замечаний: ${count('READY_FOR_OWNER')}. Требуют исправления: ${count('NEEDS_FIX')}. Текущая версия не проверена: ${count('NOT_CHECKED_CURRENT')}.`, '',
    `Обозначения: ✅ замечаний нет · ⚠️ предупреждения · ⛔ блокирует выпуск · — не выполнялось/не применимо.`, '',
    `| Урок | Уровень | Заданий | PASS / REVIEW / FAIL | ${dimIds.map((d) => DIMENSION_TITLE[d]).join(' | ')} | Итог | Выпущен |`,
    `|---|---|---|---|${dimIds.map(() => '---').join('|')}|---|---|`,
    ...rows.map((r) => `| ${r.unit_id} | ${r.level} | ${r.items_total} | ${r.verdicts.PASS} / ${r.verdicts.NEEDS_REVIEW} / ${r.verdicts.FAIL}${r.verdicts.NOT_CHECKED ? ` (+${r.verdicts.NOT_CHECKED} не пров.)` : ''} | ${r.dimensions.map((d) => MARK[d.status]).join(' | ')} | ${r.summary === 'READY_FOR_OWNER' ? 'готов к решению' : r.summary === 'NEEDS_FIX' ? '**исправить**' : 'не проверен'} | ${r.released ? 'да' : 'нет'} |`),
    '', '## Подробно', '',
  ];
  for (const r of rows) {
    out.push(`### ${r.unit_id} · ${r.title_ru} (${r.level})`, '', `${r.summary_ru}. Проверено: ${r.checked_at ?? '—'}. Открытые замечания: блокирующих ${r.open_issues.blocking}, предупреждений ${r.open_issues.warning}, информационных ${r.open_issues.info}. Выборка владельца: OK ${r.owner_sample.ok}, замечаний ${r.owner_sample.issue}.`, '');
    for (const d of r.dimensions.filter((x) => x.notes.length)) out.push(`- ${MARK[d.status]} **${d.title_ru}**: ${d.notes.join(' ')}`);
    out.push('');
  }
  return out.join('\n');
}
