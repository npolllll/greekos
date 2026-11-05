/**
 * Runs one digital QA batch over the real corpus and stores it: qa_batches → qa_item_results →
 * qa_issues (+ one digital_qa_runs summary row per object). Writes a JSON + Markdown report whose
 * SHA-256 is recorded on the batch. Never writes HUMAN_* statuses and never releases anything.
 */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { adminClient, selectAll } from '../supabase/admin.ts';
import { stableStringify } from '../content/stable-json.ts';
import { CHECKS, QA_TOOL_VERSION, checkItem, collectGreekWords, greekFields, orthography, verdictOf, type Finding, type ItemForQa, type QaContext } from './checks.ts';
import { LEXICON_ADDITIONS } from './lexicon-el.ts';
import { knownWords } from './hunspell.ts';

const run = promisify(execFile);

const DICT_CANDIDATES = [
  process.env.HUNSPELL_EL_DICT,
  '/usr/share/hunspell/el_GR',
  '/opt/homebrew/share/hunspell/el_GR',
  '/usr/local/share/hunspell/el_GR',
  `${process.env.HOME ?? ''}/Library/Spelling/el_GR`,
  resolve('local-services/dictionaries/el_GR'),
].filter((x): x is string => !!x);

/** Unknown words per hunspell el_GR (batched in one process). Null when hunspell/dictionary missing. */
export async function unknownGreekWords(words: Set<string>): Promise<{ unknown: Set<string> | null; dictionary: string | null }> {
  const dict = DICT_CANDIDATES.find((d) => existsSync(`${d}.dic`) && existsSync(`${d}.aff`));
  if (!dict || !words.size) return { unknown: null, dictionary: null };
  // Persistent pipe (hunspell.ts) first; a one-shot run if it is unavailable.
  const known = await knownWords(dict, [...words].filter((w) => w && !/\s/.test(w)));
  if (known) return { unknown: new Set([...known].filter(([w, ok]) => !ok).map(([w]) => w.toLowerCase()).filter((w) => !(w in LEXICON_ADDITIONS))), dictionary: dict };
  try {
    const child = execFile('hunspell', ['-i', 'UTF-8', '-d', dict, '-l'], { maxBuffer: 64 * 1024 * 1024, env: { ...process.env, LANG: 'C.UTF-8' } });
    let out = '';
    child.stdout?.on('data', (c) => { out += c; });
    child.stdin?.end([...words].join('\n'));
    await new Promise<void>((res, rej) => { child.on('error', rej); child.on('close', () => res()); });
    // Dictionary gaps checked by the developer (lexicon-el.ts) are not spelling errors.
    return { unknown: new Set(out.split('\n').map((s) => s.trim().toLowerCase()).filter((w) => w && !(w in LEXICON_ADDITIONS))), dictionary: dict };
  } catch {
    return { unknown: null, dictionary: null };
  }
}

export interface BatchScope { kind: 'all' | 'unit' | 'module' | 'items'; ids?: string[]; module?: string }

const ITEM_COLS = 'item_id, module, unit_id, item_type, level, scoring_strategy, requires_audio, competency_ids, audio_job_ids, envelope, current_hash, revision_id';
// Error-correction tasks contain deliberate mistakes in the prompt/stimulus.
const INTENTIONAL = /исправ|ошибк|лишн|найдите неверн|ударени|поставьте знак/i;

export async function runQaBatch(opts: { actorId: string | null; label: string; scope?: BatchScope; reportDir?: string }) {
  const db = adminClient();
  const scope = opts.scope ?? { kind: 'all' };
  const { data: batch, error: be } = await db.from('qa_batches').insert({ label: opts.label, scope, tool_version: QA_TOOL_VERSION, status: 'RUNNING', run_by: opts.actorId, checks_catalog: CHECKS }).select('id').single();
  if (be) throw new Error(be.message);
  try {
    let items = await selectAll<ItemForQa>((f, t) => db.from('items').select(ITEM_COLS).order('item_id').range(f, t));
    if (scope.kind === 'unit') items = items.filter((i) => scope.ids?.includes(i.unit_id ?? ''));
    if (scope.kind === 'module') items = items.filter((i) => i.module === scope.module);
    if (scope.kind === 'items') items = items.filter((i) => scope.ids?.includes(i.item_id));
    const unitIds = scope.kind === 'all' ? null : [...new Set(items.map((i) => i.unit_id).filter(Boolean) as string[])];

    const [units, comps, jobs, assets, rubrics, objects, claims, itemSources, scenarios] = await Promise.all([
      selectAll<{ unit_id: string; level: string; current_hash: string; teaching: Record<string, unknown>; competency_ids: string[]; revision_id: number }>((f, t) => db.from('units').select('unit_id, level, current_hash, teaching, competency_ids, revision_id').order('unit_id').range(f, t)),
      selectAll<{ competency_id: string; level: string | null }>((f, t) => db.from('competencies').select('competency_id, level').order('competency_id').range(f, t)),
      selectAll<{ audio_id: string; script_hash: string }>((f, t) => db.from('audio_jobs').select('audio_id, script_hash').order('audio_id').range(f, t)),
      selectAll<{ audio_id: string; script_hash: string; digital_status: string }>((f, t) => db.from('audio_assets').select('audio_id, script_hash, digital_status').is('invalidated_at', null).order('id').range(f, t)),
      selectAll<{ rubric_id: string }>((f, t) => db.from('rubrics').select('rubric_id').order('rubric_id').range(f, t)),
      selectAll<{ object_id: string }>((f, t) => db.from('content_objects').select('object_id').order('object_id').range(f, t)),
      selectAll<{ claim_id: string; status: string | null }>((f, t) => db.from('source_claims').select('claim_id, status').order('claim_id').range(f, t)),
      selectAll<{ item_id: string; claim_id: string }>((f, t) => db.from('item_sources').select('item_id, claim_id').order('item_id').range(f, t)),
      scope.kind === 'all' ? selectAll<{ scenario_id: string; current_hash: string; payload: Record<string, unknown>; revision_id: number }>((f, t) => db.from('speaking_scenarios').select('scenario_id, current_hash, payload, revision_id').order('scenario_id').range(f, t)) : Promise.resolve([]),
    ]);
    // Real Greek cards and ΠΕΓΠ packets are released alongside their items in the whole-package decision.
    const [rgCards, packets] = scope.kind === 'all' ? await Promise.all([
      selectAll<{ expression_id: string; expression: string; current_hash: string; payload: Record<string, unknown>; revision_id: number }>((f, t) => db.from('rg_expressions').select('expression_id, expression, current_hash, payload, revision_id').order('expression_id').range(f, t)),
      selectAll<{ packet_id: string; current_hash: string; payload: Record<string, unknown>; revision_id: number }>((f, t) => db.from('pegp_packets').select('packet_id, current_hash, payload, revision_id').order('packet_id').range(f, t)),
    ]) : [[], []];
    const revIds = [...new Set([...items.map((i) => i.revision_id), ...units.map((u) => u.revision_id), ...scenarios.map((s) => s.revision_id), ...rgCards.map((r) => r.revision_id), ...packets.map((p) => p.revision_id)])];
    const revisions = new Map<number, { content_hash: string; payload: unknown }>();
    for (let i = 0; i < revIds.length; i += 300) {
      const { data } = await db.from('content_revisions').select('id, content_hash, payload_private').in('id', revIds.slice(i, i + 300));
      for (const r of data ?? []) revisions.set(r.id, { content_hash: r.content_hash, payload: r.payload_private });
    }
    const jobHash = new Map(jobs.map((j) => [j.audio_id, j.script_hash]));
    const itemClaims = new Map<string, string[]>();
    for (const s of itemSources) itemClaims.set(s.item_id, [...(itemClaims.get(s.item_id) ?? []), s.claim_id]);

    // One dictionary lookup for every Greek word of the batch.
    const unitTexts = (u: (typeof units)[number]) => {
      const t = u.teaching as { examples_el?: string[]; vocabulary_items?: Array<{ lemma?: string; example?: string; inflection?: string }>; theory_ru?: string };
      return [...(t.examples_el ?? []).map((x, i) => ({ field: `examples_el[${i}]`, text: x })), ...(t.vocabulary_items ?? []).flatMap((v, i) => [{ field: `vocabulary[${i}].lemma`, text: v.lemma ?? '' }, { field: `vocabulary[${i}].example`, text: v.example ?? '' }, { field: `vocabulary[${i}].inflection`, text: v.inflection ?? '' }]), { field: 'theory_ru', text: t.theory_ru ?? '' }].filter((x) => x.text);
    };
    const scenarioTexts = (s: (typeof scenarios)[number]) => {
      const nodes = (s.payload.nodes as Array<{ node_id?: string; assistant_el?: string; acceptable_examples_el?: string[] }> | undefined) ?? [];
      return nodes.flatMap((n) => [{ field: `nodes.${n.node_id}.assistant_el`, text: n.assistant_el ?? '' }, ...(n.acceptable_examples_el ?? []).map((x, i) => ({ field: `nodes.${n.node_id}.acceptable[${i}]`, text: x }))]).filter((x) => x.text);
    };
    const rgTexts = (r: (typeof rgCards)[number]) => {
      const contexts = (r.payload.contexts as Array<{ example_original?: string; neutral_alternative?: string }> | undefined) ?? [];
      return [{ field: 'expression', text: r.expression }, ...contexts.flatMap((c, i) => [{ field: `contexts[${i}].example_original`, text: c.example_original ?? '' }, { field: `contexts[${i}].neutral_alternative`, text: c.neutral_alternative ?? '' }])].filter((x) => x.text);
    };
    const scopedUnits = units.filter((u) => !unitIds || unitIds.includes(u.unit_id));
    const words = collectGreekWords([...items.flatMap((i) => greekFields(i.envelope).map((x) => x.text)), ...scopedUnits.flatMap((u) => unitTexts(u).map((x) => x.text)), ...scenarios.flatMap((s) => scenarioTexts(s).map((x) => x.text)), ...rgCards.flatMap((r) => rgTexts(r).map((x) => x.text))]);
    const spell = await unknownGreekWords(words);

    const ctx: QaContext = {
      units: new Map(units.map((u) => [u.unit_id, { level: u.level, current_hash: u.current_hash }])),
      competencies: new Map(comps.map((c) => [c.competency_id, { level: c.level }])),
      audioJobs: new Set(jobs.map((j) => j.audio_id)),
      verifiedAudio: new Set(assets.filter((a) => a.digital_status === 'AUDIO_VERIFIED_DIGITAL' && a.script_hash === jobHash.get(a.audio_id)).map((a) => a.audio_id)),
      rubrics: new Set(rubrics.map((r) => r.rubric_id)),
      textObjects: new Set(objects.map((o) => o.object_id)),
      claims: new Map(claims.map((c) => [c.claim_id, { status: c.status }])),
      itemClaims,
      revisions,
      ortho: { unknownWords: spell.unknown },
    };
    const abstained = spell.unknown ? [] : ['ortho.spelling'];

    type Result = { content_kind: string; content_id: string; content_hash: string; unit_id: string | null; module: string | null; findings: Finding[] };
    const results: Result[] = [];
    for (const it of items) {
      let findings = checkItem(it, ctx);
      if (it.item_type === 'error_correction' || INTENTIONAL.test(it.envelope.prompt)) {
        // Deliberate errors live in the task text; the key itself must still be clean.
        findings = findings.map((x) => (x.check_id.startsWith('ortho.') && x.field && !/^(answer|accepted_alternatives)/.test(x.field) ? { ...x, severity: 'info' as const, message_ru: `${x.message_ru} (задание на исправление: вероятно, намеренная ошибка)` } : x));
      }
      results.push({ content_kind: 'item', content_id: it.item_id, content_hash: it.current_hash, unit_id: it.unit_id, module: it.module, findings });
    }
    for (const u of scopedUnits) {
      const f: Finding[] = [];
      const rev = revisions.get(u.revision_id);
      if (!rev || rev.content_hash !== u.current_hash) f.push({ check_id: 'hash.revision', severity: 'blocking', field: null, message_ru: 'Ревизия урока не совпадает с текущим хешем.' });
      const missing = u.competency_ids.filter((c) => !ctx.competencies.has(c));
      if (missing.length) f.push({ check_id: 'refs.competencies', severity: 'blocking', field: 'competency_ids', message_ru: `Нет компетенций: ${missing.join(', ')}.` });
      const lic = (u.teaching as { licensing?: Record<string, unknown> }).licensing;
      if (!lic) f.push({ check_id: 'rights.license', severity: 'blocking', field: 'licensing', message_ru: 'Нет блока прав урока.' });
      else if (lic.third_party_assets === true || lic.commercial_web_distribution_allowed === false) f.push({ check_id: 'rights.license', severity: 'blocking', field: 'licensing', message_ru: 'Права урока ограничены.' });
      for (const { field, text } of unitTexts(u)) {
        // Russian theory text: only its Greek words are checked; notation like "σ/ς" is not an error.
        const fs = orthography(field, text, ctx.ortho).filter((x) => !(field === 'theory_ru' && ['ortho.question_mark', 'ortho.spacing'].includes(x.check_id)));
        f.push(...(field === 'theory_ru' ? fs.map((x) => (x.check_id === 'ortho.final_sigma' && /σ\/ς|σ, ς|ς\)/.test(text) ? { ...x, severity: 'info' as const } : x)) : fs));
      }
      f.push({ check_id: 'human.review', severity: 'info', field: null, message_ru: 'Независимая проверка преподавателем не проводилась.' });
      results.push({ content_kind: 'unit', content_id: u.unit_id, content_hash: u.current_hash, unit_id: u.unit_id, module: 'core', findings: f });
    }
    const itemIds = new Set(items.map((i) => i.item_id));
    const licenseFindings = (lic: Record<string, unknown> | undefined, what: string): Finding[] =>
      !lic ? [{ check_id: 'rights.license', severity: 'blocking', field: 'licensing', message_ru: `Нет блока прав ${what}.` }]
        : lic.third_party_assets === true || lic.commercial_web_distribution_allowed === false ? [{ check_id: 'rights.license', severity: 'blocking', field: 'licensing', message_ru: `Права ${what} ограничены.` }] : [];
    for (const s of scenarios) {
      const f: Finding[] = [];
      const rev = revisions.get(s.revision_id);
      if (!rev || rev.content_hash !== s.current_hash) f.push({ check_id: 'hash.revision', severity: 'blocking', field: null, message_ru: 'Ревизия сценария не совпадает с текущим хешем.' });
      const lic = s.payload.licensing as Record<string, unknown> | undefined;
      // A Real Greek scenario is the branching scene of its expression cards: it carries their rights.
      const parents = ((s.payload.expression_ids as string[] | undefined) ?? []).map((id) => rgCards.find((r) => r.expression_id === id));
      const inherited = !lic && parents.length > 0 && parents.every((r) => r && !licenseFindings(r.payload.licensing as Record<string, unknown> | undefined, '').length);
      if (inherited) f.push({ check_id: 'rights.license', severity: 'info', field: 'licensing', message_ru: `Права по карточкам Real Greek (${(s.payload.expression_ids as string[]).join(', ')}).` });
      else f.push(...licenseFindings(lic, 'сценария'));
      for (const { field, text } of scenarioTexts(s)) f.push(...orthography(field, text, ctx.ortho));
      f.push({ check_id: 'human.review', severity: 'info', field: null, message_ru: 'Сценарий не проверялся преподавателем; свободный AI-диалог требует подключённого LLM.' });
      results.push({ content_kind: 'scenario', content_id: s.scenario_id, content_hash: s.current_hash, unit_id: null, module: 'speaking', findings: f });
    }

    for (const r of rgCards) {
      const f: Finding[] = [];
      const rev = revisions.get(r.revision_id);
      if (!rev || rev.content_hash !== r.current_hash) f.push({ check_id: 'hash.revision', severity: 'blocking', field: null, message_ru: 'Ревизия карточки не совпадает с текущим хешем.' });
      f.push(...licenseFindings(r.payload.licensing as Record<string, unknown> | undefined, 'карточки'));
      const learning = ((r.payload.learning_items as Array<{ item_id?: string }> | undefined) ?? []).map((x) => x.item_id).filter((x): x is string => !!x);
      const missing = learning.filter((id) => !itemIds.has(id));
      if (!learning.length) f.push({ check_id: 'content.practice', severity: 'blocking', field: 'learning_items', message_ru: 'У карточки нет упражнений.' });
      if (missing.length) f.push({ check_id: 'refs.items', severity: 'blocking', field: 'learning_items', message_ru: `Нет заданий: ${missing.join(', ')}.` });
      // Source risk flags mean «can sound rude in the wrong context», not that the expression is rude;
      // a card that shows the risk and a neutral alternative for every context teaches exactly that.
      // Sexual content, profanity or a context without a neutral alternative needs the owner's decision.
      const safety = r.payload.safety as { offensive?: boolean; sexual?: boolean; profanity_level?: number; potential_disrespect_risk?: boolean } | undefined;
      const ctxs = (r.payload.contexts as Array<{ neutral_alternative?: string }> | undefined) ?? [];
      const allNeutral = ctxs.length > 0 && ctxs.every((c) => (c.neutral_alternative ?? '').trim());
      if (safety?.sexual || (safety?.profanity_level ?? 0) > 1) f.push({ check_id: 'safety.register', severity: 'warning', field: 'safety', message_ru: 'Карточка с интимной или нецензурной лексикой — нужен осознанный допуск владельца.' });
      else if ((safety?.offensive || safety?.potential_disrespect_risk) && !allNeutral) f.push({ check_id: 'safety.register', severity: 'warning', field: 'contexts', message_ru: 'Выражение может прозвучать грубо, а у части ситуаций нет нейтральной замены.' });
      else if (safety?.offensive || safety?.potential_disrespect_risk) f.push({ check_id: 'safety.register', severity: 'info', field: 'safety', message_ru: 'Может прозвучать грубо в неподходящей ситуации; карточка показывает риск и нейтральную замену.' });
      for (const { field, text } of rgTexts(r)) f.push(...orthography(field, text, ctx.ortho));
      f.push({ check_id: 'human.review', severity: 'info', field: null, message_ru: 'Социолингвистическая проверка носителем не проводилась; интонация без проверенного аудио.' });
      results.push({ content_kind: 'rg_expression', content_id: r.expression_id, content_hash: r.current_hash, unit_id: null, module: 'real_greek', findings: f });
    }
    for (const pk of packets) {
      const f: Finding[] = [];
      const rev = revisions.get(pk.revision_id);
      if (!rev || rev.content_hash !== pk.current_hash) f.push({ check_id: 'hash.revision', severity: 'blocking', field: null, message_ru: 'Ревизия пакета не совпадает с текущим хешем.' });
      const blockers = ((pk.payload.blockers as string[] | undefined) ?? []).map(String);
      if (blockers.some((b) => /RIGHTS|REPUBLICATION/i.test(b))) f.push({ check_id: 'rights.third_party', severity: 'blocking', field: 'blockers', message_ru: `Права на перепубликацию источника не урегулированы (${blockers.filter((b) => /RIGHTS|REPUBLICATION/i.test(b)).join(', ')}).` });
      const status = String(pk.payload.status ?? '');
      if (/NOT_RELEASED|PARTIAL/i.test(status)) f.push({ check_id: 'content.status', severity: 'blocking', field: 'status', message_ru: `Автор пометил пакет как незавершённый (${status}).` });
      const refs = [...((pk.payload.item_ids as string[] | undefined) ?? []), ...((pk.payload.language_item_ids as string[] | undefined) ?? [])].filter((id) => !itemIds.has(id));
      if (refs.length) f.push({ check_id: 'refs.items', severity: 'blocking', field: 'item_ids', message_ru: `Нет заданий: ${refs.slice(0, 5).join(', ')}${refs.length > 5 ? '…' : ''}.` });
      f.push({ check_id: 'human.review', severity: 'info', field: null, message_ru: 'Фактическая и языковая проверка человеком не проводилась; материалы — учебная подготовка, не официальный банк.' });
      results.push({ content_kind: 'pegp_packet', content_id: pk.packet_id, content_hash: pk.current_hash, unit_id: null, module: 'pegp', findings: f });
    }

    // Persist
    const counts: Record<string, number> = { PASS: 0, NEEDS_REVIEW: 0, FAIL: 0, ABSTAIN: 0 };
    const byCheck: Record<string, { blocking: number; warning: number; info: number; objects: number }> = {};
    const resultRows = results.map((r) => {
      const verdict = verdictOf(r.findings, abstained);
      counts[verdict] += 1;
      const seen = new Set<string>();
      for (const x of r.findings) {
        byCheck[x.check_id] ??= { blocking: 0, warning: 0, info: 0, objects: 0 };
        byCheck[x.check_id][x.severity] += 1;
        if (!seen.has(x.check_id)) { byCheck[x.check_id].objects += 1; seen.add(x.check_id); }
      }
      const checks = Object.fromEntries(CHECKS.map((c) => [c.id, r.findings.some((x) => x.check_id === c.id && x.severity === 'blocking') ? 'FAIL' : r.findings.some((x) => x.check_id === c.id && x.severity === 'warning') ? 'WARN' : abstained.includes(c.id) ? 'ABSTAIN' : 'PASS']));
      return { batch_id: batch.id, content_kind: r.content_kind, content_id: r.content_id, content_hash: r.content_hash, unit_id: r.unit_id, module: r.module, verdict, checks, blocking_count: r.findings.filter((x) => x.severity === 'blocking').length, warning_count: r.findings.filter((x) => x.severity === 'warning').length };
    });
    for (let i = 0; i < resultRows.length; i += 500) {
      const { error } = await db.from('qa_item_results').insert(resultRows.slice(i, i + 500));
      if (error) throw new Error(error.message);
    }
    const issueRows = results.flatMap((r) => r.findings.filter((x) => x.severity !== 'info' || ['rights.license', 'modality.audio'].includes(x.check_id)).map((x) => ({
      batch_id: batch.id, content_kind: r.content_kind, content_id: r.content_id, content_hash: r.content_hash, check_id: x.check_id, severity: x.severity, field: x.field, message_ru: x.message_ru, evidence: x.evidence ?? {}, suggestion: x.suggestion ?? null,
    })));
    for (let i = 0; i < issueRows.length; i += 1000) {
      const { error } = await db.from('qa_issues').insert(issueRows.slice(i, i + 1000));
      if (error) throw new Error(error.message);
    }
    const runRows = resultRows.map((r) => ({ content_kind: r.content_kind, content_id: r.content_id, content_hash: r.content_hash, check_kind: 'MACHINE_CONTENT_QA', tool_id: `${QA_TOOL_VERSION}${spell.dictionary ? '+hunspell-el_GR' : ''}`, verdict: r.verdict, report: { batch_id: batch.id, blocking: r.blocking_count, warnings: r.warning_count }, run_by: opts.actorId }));
    for (let i = 0; i < runRows.length; i += 1000) await db.from('digital_qa_runs').insert(runRows.slice(i, i + 1000));
    // Earlier open issues of the same objects/hashes are superseded by this batch.
    const ids = [...new Set(results.map((r) => r.content_id))];
    for (let i = 0; i < ids.length; i += 300) await db.from('qa_issues').update({ status: 'superseded' }).neq('batch_id', batch.id).eq('status', 'open').in('content_id', ids.slice(i, i + 300));

    const report = {
      batch_id: batch.id, label: opts.label, tool_version: QA_TOOL_VERSION, generated_at: new Date().toISOString(), scope,
      dictionary: spell.dictionary ? { engine: 'hunspell', path: spell.dictionary, unique_greek_words: words.size, unknown_words: spell.unknown?.size ?? null } : { engine: null, note: 'hunspell el_GR не найден — проверка словарём ABSTAIN' },
      totals: { objects: results.length, items: items.length, units: scopedUnits.length, scenarios: scenarios.length, issues_stored: issueRows.length, ...counts },
      by_check: CHECKS.map((c) => ({ ...c, ...(byCheck[c.id] ?? { blocking: 0, warning: 0, info: 0, objects: 0 }) })),
      not_performed: ['Независимая экспертиза преподавателем, экзаменатором или носителем языка', 'Проверка смысла и прагматики свободным текстом (нужен LLM-провайдер или человек)', 'Акустическая оценка аудио слушателем'],
    };
    const json = stableStringify(report);
    const sha = createHash('sha256').update(json).digest('hex');
    const dir = opts.reportDir ?? resolve('reports/v7/qa');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `QA_BATCH_${batch.id}.json`);
    writeFileSync(path, JSON.stringify(report, null, 1));
    writeFileSync(join(dir, `QA_BATCH_${batch.id}.md`), markdown(report));
    await db.from('qa_batches').update({ status: 'COMPLETED', finished_at: new Date().toISOString(), counts: report.totals, report_sha256: sha, report_path: path.replace(resolve('.') + '/', '') }).eq('id', batch.id);
    return { batch_id: batch.id, totals: report.totals, report_sha256: sha, report_path: path };
  } catch (e) {
    await db.from('qa_batches').update({ status: 'FAILED', finished_at: new Date().toISOString(), counts: { error: (e as Error).message.slice(0, 300) } }).eq('id', batch.id);
    throw e;
  }
}

function markdown(r: { batch_id: string; label: string; tool_version: string; generated_at: string; totals: Record<string, number>; dictionary: Record<string, unknown>; by_check: Array<{ id: string; group: string; title_ru: string; severity: string; blocking: number; warning: number; info: number; objects: number }>; not_performed: string[] }) {
  const lines = [
    `# Цифровой QA корпуса — пакет ${r.batch_id}`, '',
    `${r.label} · ${r.tool_version} · ${r.generated_at}`, '',
    '> Автоматическая проверка. Это **не** экспертиза преподавателя, экзаменатора или носителя языка.', '',
    `Объектов: **${r.totals.objects}** (заданий ${r.totals.items}, уроков ${r.totals.units}, сценариев ${r.totals.scenarios}). PASS ${r.totals.PASS} · NEEDS_REVIEW ${r.totals.NEEDS_REVIEW} · FAIL ${r.totals.FAIL}.`, '',
    `Словарь: ${r.dictionary.engine ? `hunspell el_GR, ${r.dictionary.unique_greek_words} уникальных греческих слов, ${r.dictionary.unknown_words} не найдено` : 'не найден — проверка словарём не выполнялась (ABSTAIN)'}.`, '',
    '| Группа | Проверка | Строгость | Блок. | Предупр. | Инфо | Объектов |', '|---|---|---|---:|---:|---:|---:|',
    ...r.by_check.map((c) => `| ${c.group} | ${c.title_ru} (\`${c.id}\`) | ${c.severity} | ${c.blocking} | ${c.warning} | ${c.info} | ${c.objects} |`),
    '', '## Не выполнялось автоматически', ...r.not_performed.map((x) => `- ${x}`), '',
  ];
  return lines.join('\n');
}
