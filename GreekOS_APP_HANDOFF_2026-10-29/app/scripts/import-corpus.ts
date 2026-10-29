/**
 * GreekOS canonical corpus importer.
 *
 *   npm run import:validate            # validate only, no database writes
 *   npm run import                     # validate, then import in ONE transaction
 *
 * Env: CORPUS_ROOT (unpacked GreekOS_CLAUDE_UPLOAD_READY), DATABASE_URL (direct Postgres URL).
 * Order follows CONTRACTS/IMPLEMENTATION.json#import.order. Same ID + same hash is idempotent;
 * a changed hash creates a new immutable revision, revokes releases bound to the old hash and
 * invalidates dependent synthesized audio. Learner attempts are never touched.
 */
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import postgres from 'postgres';
import Ajv2020 from 'ajv/dist/2020.js';
import { contentHash, jsonEqual, sha256Hex } from '../src/lib/content/stable-json.ts';

const TOOL_VERSION = 'greekos-import/1.0.0';
const args = new Set(process.argv.slice(2));
const validateOnly = args.has('--validate-only');
const reportDir = process.env.IMPORT_REPORT_DIR;

const root = resolve(process.env.CORPUS_ROOT ?? '../spec/GreekOS_CLAUDE_UPLOAD_READY');
if (!existsSync(join(root, 'HANDOFF_IMPORT/items.json'))) {
  console.error(`CORPUS_ROOT does not contain HANDOFF_IMPORT/items.json: ${root}`);
  process.exit(2);
}

type Json = any; // canonical payloads are heterogeneous by design
const rd = (p: string): Json => JSON.parse(readFileSync(join(root, p), 'utf8'));
const fileSha = (p: string) => sha256Hex(readFileSync(join(root, p)));

interface Problem { kind: string; id: string | null; path: string; reason: string }
const problems: Problem[] = [];
let checks = 0;
function check(ok: boolean, kind: string, id: string | null, path: string, reason: string) {
  checks++;
  if (!ok) problems.push({ kind, id, path, reason });
}

// ---------- load ----------
const items: Json[] = rd('HANDOFF_IMPORT/items.json');
const units: Json[] = rd('HANDOFF_IMPORT/units.json');
const itemSchema = rd('HANDOFF_IMPORT/item.schema.json');
const unitSchema = rd('schemas/unit.schema.json');
const coreComps: Json[] = rd('HANDOFF_IMPORT/competencies.json');
const extComps: Json[] = rd('HANDOFF_IMPORT/external_competencies.json');
const claims: Json[] = rd('HANDOFF_IMPORT/source_claims.json');
const audioJobs: Json[] = rd('HANDOFF_IMPORT/audio_jobs.json');
const rubricIndex: Record<string, Json[]> = rd('HANDOFF_IMPORT/rubric_index.json');
const objectIndex: Record<string, Json[]> = rd('HANDOFF_IMPORT/object_index.json');
const scenarios: Json[] = rd('HANDOFF_IMPORT/speaking_scenarios.json');
const exams: Json = rd('HANDOFF_IMPORT/exams.json');
const unresolved: Json = rd('HANDOFF_IMPORT/unresolved_tags.json');
const tagDecisions: Json = rd('GreekOS_QA_Reports/readiness12/ERROR_TAG_DECISIONS.json');

const inputHashes: Record<string, string> = {};
for (const p of [
  'HANDOFF_IMPORT/items.json', 'HANDOFF_IMPORT/units.json', 'HANDOFF_IMPORT/item.schema.json',
  'HANDOFF_IMPORT/competencies.json', 'HANDOFF_IMPORT/external_competencies.json',
  'HANDOFF_IMPORT/source_claims.json', 'HANDOFF_IMPORT/audio_jobs.json', 'HANDOFF_IMPORT/rubric_index.json',
  'HANDOFF_IMPORT/object_index.json', 'HANDOFF_IMPORT/speaking_scenarios.json', 'HANDOFF_IMPORT/exams.json',
  'CONTRACTS/IMPLEMENTATION.json',
]) inputHashes[p] = fileSha(p);

// ---------- validate ----------
const ajv = new Ajv2020({ strict: false, allErrors: true });
const validateItem = ajv.compile(itemSchema);
const validateUnit = ajv.compile(unitSchema);

const unitIds = new Set(units.map((u) => u.unit_id));
const comps = [...coreComps, ...extComps];
const compIds = new Set(comps.map((c) => c.competency_id));
const claimIds = new Set(claims.map((c) => c.claim_id));
const audioIds = new Set(audioJobs.map((j) => j.audio_id));
const itemIds = new Set(items.map((i) => i.item_id));

check(unitIds.size === units.length, 'unit', null, 'units.json', 'duplicate unit ids');
check(itemIds.size === items.length, 'item', null, 'items.json', 'duplicate item ids');
check(compIds.size === comps.length, 'competency', null, 'competencies', 'duplicate competency ids');
check(claimIds.size === claims.length, 'source_claim', null, 'source_claims.json', 'duplicate claim ids');
check(audioIds.size === audioJobs.length, 'audio_job', null, 'audio_jobs.json', 'duplicate audio ids');

function resolvePointer(doc: Json, pointer: string): Json {
  if (!pointer) return doc;
  return pointer.split('/').slice(1).reduce((acc: Json, raw) => {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    return acc == null ? undefined : acc[key];
  }, doc);
}

for (const i of items) {
  const id = i.item_id;
  const ok = validateItem(i);
  check(!!ok, 'item', id, 'item.schema.json', ok ? '' : ajv.errorsText(validateItem.errors));
  const p = join(root, i.canonical.path);
  const exists = existsSync(p);
  check(exists, 'item', id, i.canonical.path, 'canonical file missing');
  if (exists) {
    check(fileSha(i.canonical.path) === i.canonical.sha256, 'item', id, i.canonical.path, 'canonical sha256 mismatch');
    check(jsonEqual(JSON.parse(readFileSync(p, 'utf8')), i.original_payload), 'item', id, i.canonical.path, 'original_payload differs from canonical file');
  }
  check(i.unit_id === null || unitIds.has(i.unit_id), 'item', id, 'unit_id', `unknown unit ${i.unit_id}`);
  for (const c of [...i.competency_ids, ...i.prerequisite_ids]) check(compIds.has(c), 'item', id, 'competency_ids', `unknown competency ${c}`);
  for (const s of i.source_claim_ids) check(claimIds.has(s), 'item', id, 'source_claim_ids', `unknown source claim ${s}`);
  for (const a of i.audio_job_ids) check(audioIds.has(a), 'item', id, 'audio_job_ids', `unknown audio job ${a}`);
  if (typeof i.rubric === 'string') check(!!rubricIndex[i.rubric], 'item', id, 'rubric', `unknown rubric ${i.rubric}`);
  if (i.stimulus && typeof i.stimulus === 'object' && i.stimulus.text_id) check(!!objectIndex[i.stimulus.text_id], 'item', id, 'stimulus.text_id', `unknown text ${i.stimulus.text_id}`);
  if (['CHOICE_KEY', 'EXACT_WITH_REVIEW_FALLBACK', 'STRUCTURED_WITH_REVIEW_FALLBACK'].includes(i.scoring.strategy)) check(i.answer.length > 0, 'item', id, 'answer', 'missing key for keyed strategy');
  check(i.release.learner_access === false && i.release.automatic_mastery === false, 'item', id, 'release', 'item not imported as CONTENT_GATED');
}

for (const u of units) {
  check(fileSha(u.canonical_path) === u.content_hash, 'unit', u.unit_id, u.canonical_path, 'unit content_hash mismatch');
  check(jsonEqual(rd(u.canonical_path), u.teaching_material), 'unit', u.unit_id, u.canonical_path, 'teaching_material differs from canonical');
  const ok = validateUnit(u.teaching_material);
  check(!!ok, 'unit', u.unit_id, 'schemas/unit.schema.json', ok ? '' : ajv.errorsText(validateUnit.errors));
}

for (const [rid, refs] of Object.entries(rubricIndex)) for (const ref of refs) {
  check(existsSync(join(root, ref.path)) && fileSha(ref.path) === ref.sha256, 'rubric', rid, ref.path, 'rubric file missing or hash mismatch');
}
for (const [oid, refs] of Object.entries(objectIndex)) for (const ref of refs) {
  check(existsSync(join(root, ref.path)) && fileSha(ref.path) === ref.sha256, 'object', oid, ref.path, 'object file missing or hash mismatch');
}

{ // core prerequisite DAG
  const graph = new Map<string, string[]>(coreComps.map((c) => [c.competency_id, c.prerequisites]));
  const state = new Map<string, 1 | 2>();
  let acyclic = true;
  const dfs = (c: string) => {
    if (state.get(c) === 1) { acyclic = false; return; }
    if (state.get(c) === 2) return;
    state.set(c, 1);
    for (const p of graph.get(c) ?? []) { if (!graph.has(p)) { acyclic = false; return; } dfs(p); }
    state.set(c, 2);
  };
  for (const c of graph.keys()) dfs(c);
  check(acyclic, 'competency', null, 'competencies.json', 'core prerequisite graph is not a DAG');
}

let componentCount = 0;
for (const f of exams.forms) {
  for (const k of ['assembly', 'candidate', 'editor']) check(fileSha(f[`${k}_path`]) === f[`${k}_sha256`], 'exam_form', f.form_id, f[`${k}_path`], `${k} hash mismatch`);
  for (const c of f.components) {
    componentCount++;
    for (const k of ['form', 'candidate']) check(fileSha(c[`${k}_path`]) === c[`${k}_sha256`], 'exam_component', c.form_id, c[`${k}_path`], `${k} hash mismatch`);
    for (const iid of c.item_ids) check(itemIds.has(iid), 'exam_component', c.form_id, 'item_ids', `unknown item ${iid}`);
  }
}
check(componentCount === 15, 'exam_component', null, 'exams.json', `expected 15 components, found ${componentCount}`);

for (const s of scenarios) check(fileSha(s.path) === s.sha256 && jsonEqual(rd(s.path), s.payload), 'scenario', s.scenario_id, s.path, 'scenario hash/payload mismatch');

{
  const byId = new Map(items.map((i) => [i.item_id, i]));
  check(unresolved.item_ids.length === 1031 && unresolved.item_ids.every((id: string) => byId.get(id)?.error_tags === null), 'item', null, 'unresolved_tags.json', '1031 unresolved tags must remain null');
  for (const d of tagDecisions.decisions) check(jsonEqual(byId.get(d.item_id)?.error_tags, d.candidate_tags), 'item', d.item_id, 'ERROR_TAG_DECISIONS.json', 'grounded tag decision not preserved');
}

// ---------- derived records ----------
const LEVEL_INDEX: Record<string, number> = { A1: 1, A2: 2, B1: 3, B2: 4 };
const unitSection = new Map<string, string>();
for (const u of units) {
  const tm = u.teaching_material;
  const put = (ids: string[] | string | undefined, section: string) => {
    for (const id of ([] as string[]).concat(ids ?? [])) if (!unitSection.has(id)) unitSection.set(id, section);
  };
  put(tm.diagnostic_item_ids, 'diagnostic');
  put(tm.guided_practice, 'guided_practice');
  put(tm.active_recall, 'active_recall');
  put(tm.reading_tasks, 'reading');
  put(tm.listening_tasks, 'listening');
  put(tm.writing_tasks, 'writing');
  put(tm.speaking_tasks, 'speaking');
  put(tm.transfer_task, 'transfer');
  put(tm.review_plan?.item_ids, 'retention');
}

function loadRef(ref: Json): Json {
  return resolvePointer(rd(ref.path), ref.pointer ?? '');
}

const rgDir = 'GreekOS_Real_Greek/expressions';
const rgFiles = readdirSync(join(root, rgDir)).filter((f) => f.endsWith('.json')).sort();
const pegpThematic = readdirSync(join(root, 'GreekOS_PEGP_Module')).filter((f) => /^PEGP-2026-11-P\d+\.json$/.test(f)).sort();
const pegpLanguage = readdirSync(join(root, 'GreekOS_PEGP_Module/language_support')).filter((f) => /^PEGP-LANG-P\d+\.json$/.test(f)).sort();
const singletonFiles: Record<string, string> = {
  diagnostic_protocol: 'GreekOS_Academic_Corpus/diagnostics/ENTRY_PROTOCOL.json',
  u01_joint_adjudication: 'GreekOS_B2_Exam_Bank/U01_JOINT_ADJUDICATION.json',
  competency_graph: 'SPEC/COMPETENCY_GRAPH.json',
  error_taxonomy: 'SPEC/ERROR_TAXONOMY.json',
  pegp_catalog_coverage: 'GreekOS_PEGP_Module/CATALOG_COVERAGE_INVENTORY_10.json',
  pegp_module: 'GreekOS_PEGP_Module/module.json',
  rg_module: 'GreekOS_Real_Greek/MODULE_MANIFEST.json',
  publication_gates: 'ACADEMIC_PUBLICATION_GATES.json',
  exam_bank_index: 'GreekOS_B2_Exam_Bank/EXAM_BANK_INDEX.json',
  l01_practice_scoring: 'GreekOS_B2_Exam_Bank/L01_PRACTICE_SCORING.json',
  context_example_fixture: 'LEARNING_CONTEXT/V5_2/fixtures/context_example.json',
};
for (const [k, p] of Object.entries(singletonFiles)) check(existsSync(join(root, p)), 'singleton', k, p, 'file missing');

function componentKind(id: string): string {
  const letter = id.split('-')[2]?.[0];
  return ({ R: 'reading', U: 'use_of_language', L: 'listening', P: 'writing', W: 'writing', S: 'speaking' } as Record<string, string>)[letter] ?? 'reading';
}

const summary = {
  root_label: root.split('/').slice(-1)[0],
  checks,
  problems: problems.length,
  counts: {
    items: items.length, units: units.length, core_competencies: coreComps.length,
    external_competencies: extComps.length, source_claims: claims.length, audio_jobs: audioJobs.length,
    rubrics: Object.keys(rubricIndex).length, objects: Object.keys(objectIndex).length,
    scenarios: scenarios.length, exam_components: componentCount, rg_expressions: rgFiles.length,
    pegp_packets: pegpThematic.length + pegpLanguage.length,
  },
};

function writeReport(extra: Record<string, unknown>) {
  if (!reportDir) return;
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(join(reportDir, 'import_report.json'), JSON.stringify({ tool: TOOL_VERSION, input_hashes: inputHashes, ...summary, problems_detail: problems, ...extra }, null, 2) + '\n');
}

if (problems.length) {
  console.error(`Validation failed: ${problems.length} problem(s). Nothing was imported.`);
  console.error(JSON.stringify(problems.slice(0, 30), null, 2));
  writeReport({ status: 'VALIDATION_FAILED' });
  process.exit(1);
}
console.log(`Validation PASS: ${checks} checks`, JSON.stringify(summary.counts));
if (validateOnly) {
  writeReport({ status: 'VALIDATED_ONLY' });
  process.exit(0);
}

// ---------- import (single transaction) ----------
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) { console.error('DATABASE_URL is required for import'); process.exit(2); }
const sql = postgres(dbUrl, { max: 1, onnotice: () => {} });

type Stat = { inserted: number; unchanged: number; changed: number };
const stats: Record<string, Stat> = {};
const bump = (k: string, f: keyof Stat) => { (stats[k] ??= { inserted: 0, unchanged: 0, changed: 0 })[f]++; };

try {
  const result = await sql.begin(async (tx) => {
    const [run] = await tx`insert into import_runs (status, tool_version, corpus_label, input_hashes)
      values ('RUNNING', ${TOOL_VERSION}, ${summary.root_label}, ${tx.json(inputHashes)}) returning id`;
    const runId: string = run.id;

    /** Inserts an immutable revision (idempotent) and reports whether the current hash changed. */
    async function revision(kind: string, id: string, hash: string, module: string | null, payload: Json, currentTable: string, idCol: string) {
      const [existing] = await tx.unsafe(`select current_hash from public.${currentTable} where ${idCol} = $1`, [id]);
      let [rev] = await tx`insert into content_revisions (content_kind, content_id, content_hash, module, payload_private, import_run_id)
        values (${kind}, ${id}, ${hash}, ${module}, ${tx.json(payload)}, ${runId})
        on conflict (content_kind, content_id, content_hash) do nothing
        returning id`;
      if (!rev) [rev] = await tx`select id from content_revisions where content_kind = ${kind} and content_id = ${id} and content_hash = ${hash}`;
      const status: keyof Stat = !existing ? 'inserted' : existing.current_hash === hash ? 'unchanged' : 'changed';
      bump(kind, status);
      if (status === 'changed') {
        await tx`update content_releases set revoked_at = now(), revoked_reason = 'CONTENT_HASH_CHANGED'
          where content_id = ${id} and content_hash <> ${hash} and revoked_at is null`;
      }
      return { revisionId: rev.id as number, status };
    }

    // 1. source_claims
    for (const c of claims) {
      const h = contentHash(c);
      const { revisionId } = await revision('source_claim', c.claim_id, h, null, c, 'source_claims', 'claim_id');
      await tx`insert into source_claims (claim_id, source_id, status, record, evidence_path, evidence_file_sha256, current_hash, revision_id)
        values (${c.claim_id}, ${c.record?.source_id ?? null}, ${c.record?.status ?? null}, ${tx.json(c.record ?? {})}, ${c.evidence_path ?? null}, ${c.evidence_file_sha256 ?? null}, ${h}, ${revisionId})
        on conflict (claim_id) do update set source_id = excluded.source_id, status = excluded.status, record = excluded.record,
          evidence_path = excluded.evidence_path, evidence_file_sha256 = excluded.evidence_file_sha256, current_hash = excluded.current_hash, revision_id = excluded.revision_id`;
    }

    // 2. competencies + external competencies
    for (const c of comps) {
      const external = !!c.module;
      const h = contentHash(c);
      const { revisionId } = await revision('competency', c.competency_id, h, c.module ?? 'core', c, 'competencies', 'competency_id');
      await tx`insert into competencies (competency_id, scope, module, level, name, prerequisites, primary_unit_ids, definition, current_hash, revision_id)
        values (${c.competency_id}, ${external ? 'external' : 'core'}, ${c.module ?? 'core'}, ${c.level ?? null},
          ${c.name ?? c.definition?.observable_outcome ?? null}, ${external ? [] : c.prerequisites}, ${c.primary_unit_ids ?? []},
          ${tx.json(c)}, ${h}, ${revisionId})
        on conflict (competency_id) do update set scope = excluded.scope, module = excluded.module, level = excluded.level, name = excluded.name,
          prerequisites = excluded.prerequisites, primary_unit_ids = excluded.primary_unit_ids, definition = excluded.definition,
          current_hash = excluded.current_hash, revision_id = excluded.revision_id`;
    }

    // 3. rubric_index + object_index (payload resolved from canonical files; hash = file hash)
    for (const [rid, refs] of Object.entries(rubricIndex)) {
      const payload = loadRef(refs[0]);
      const h = refs[0].sha256;
      const { revisionId } = await revision('rubric', rid, h, null, { refs, payload }, 'rubrics', 'rubric_id');
      await tx`insert into rubrics (rubric_id, refs, payload, current_hash, revision_id) values (${rid}, ${tx.json(refs)}, ${tx.json(payload)}, ${h}, ${revisionId})
        on conflict (rubric_id) do update set refs = excluded.refs, payload = excluded.payload, current_hash = excluded.current_hash, revision_id = excluded.revision_id`;
    }
    for (const [oid, refs] of Object.entries(objectIndex)) {
      const payload = loadRef(refs[0]);
      const h = contentHash({ sha: refs.map((r) => r.sha256), pointer: refs[0].pointer ?? '' });
      const { revisionId } = await revision('object', oid, h, null, { refs, payload }, 'content_objects', 'object_id');
      await tx`insert into content_objects (object_id, refs, payload, current_hash, revision_id) values (${oid}, ${tx.json(refs)}, ${tx.json(payload)}, ${h}, ${revisionId})
        on conflict (object_id) do update set refs = excluded.refs, payload = excluded.payload, current_hash = excluded.current_hash, revision_id = excluded.revision_id`;
    }

    // 4. units
    for (const u of units) {
      const tm = u.teaching_material;
      const num = Number(u.unit_id.split('-')[2]);
      const { revisionId } = await revision('unit', u.unit_id, u.content_hash, 'core', u, 'units', 'unit_id');
      await tx`insert into units (unit_id, level, sort_key, title_ru, prerequisites, soft_prerequisites, competency_ids, primary_competencies, estimated_active_minutes, teaching, current_hash, revision_id)
        values (${u.unit_id}, ${tm.cefr_level}, ${LEVEL_INDEX[tm.cefr_level] * 100 + num}, ${tm.title_ru}, ${tm.prerequisites ?? []}, ${tm.soft_prerequisites ?? []},
          ${tm.competency_ids ?? []}, ${tm.primary_competencies ?? []}, ${tm.estimated_active_minutes ?? null}, ${tx.json(tm)}, ${u.content_hash}, ${revisionId})
        on conflict (unit_id) do update set level = excluded.level, sort_key = excluded.sort_key, title_ru = excluded.title_ru, prerequisites = excluded.prerequisites,
          soft_prerequisites = excluded.soft_prerequisites, competency_ids = excluded.competency_ids, primary_competencies = excluded.primary_competencies,
          estimated_active_minutes = excluded.estimated_active_minutes, teaching = excluded.teaching, current_hash = excluded.current_hash, revision_id = excluded.revision_id`;
    }

    // 5. audio jobs (before items: item_audio FK). Changed script hash invalidates synthesized assets.
    for (const j of audioJobs) {
      const h = contentHash(j);
      const { revisionId, status } = await revision('audio_job', j.audio_id, h, null, j, 'audio_jobs', 'audio_id');
      await tx`insert into audio_jobs (audio_id, status, priority, script_hash, text_el, segments, payload, current_hash, revision_id)
        values (${j.audio_id}, ${j.status}, ${j.priority == null ? null : String(j.priority)}, ${j.script_version_hash}, ${j.text_el ?? null}, ${tx.json(j.segments ?? [])}, ${tx.json(j)}, ${h}, ${revisionId})
        on conflict (audio_id) do update set status = excluded.status, priority = excluded.priority, script_hash = excluded.script_hash, text_el = excluded.text_el,
          segments = excluded.segments, payload = excluded.payload, current_hash = excluded.current_hash, revision_id = excluded.revision_id`;
      if (status === 'changed') {
        await tx`update audio_assets set invalidated_at = now(), invalidated_reason = 'SCRIPT_HASH_CHANGED'
          where audio_id = ${j.audio_id} and script_hash <> ${j.script_version_hash} and invalidated_at is null`;
      }
    }

    // 6. items + relations
    for (const i of items) {
      const h = contentHash(i);
      const { revisionId } = await revision('item', i.item_id, h, i.module, i, 'items', 'item_id');
      await tx`insert into items (item_id, module, unit_id, item_type, level, pool, section, requires_audio, scoring_strategy, competency_ids, prerequisite_ids, audio_job_ids, error_tags, envelope, current_hash, revision_id)
        values (${i.item_id}, ${i.module}, ${i.unit_id}, ${i.type}, ${i.level}, ${i.original_payload?.pool ?? null}, ${unitSection.get(i.item_id) ?? null},
          ${i.requires_audio}, ${i.scoring.strategy}, ${i.competency_ids}, ${i.prerequisite_ids}, ${i.audio_job_ids}, ${i.error_tags}, ${tx.json(i)}, ${h}, ${revisionId})
        on conflict (item_id) do update set module = excluded.module, unit_id = excluded.unit_id, item_type = excluded.item_type, level = excluded.level,
          pool = excluded.pool, section = excluded.section, requires_audio = excluded.requires_audio, scoring_strategy = excluded.scoring_strategy,
          competency_ids = excluded.competency_ids, prerequisite_ids = excluded.prerequisite_ids, audio_job_ids = excluded.audio_job_ids,
          error_tags = excluded.error_tags, envelope = excluded.envelope, current_hash = excluded.current_hash, revision_id = excluded.revision_id`;
      await tx`delete from item_competencies where item_id = ${i.item_id}`;
      await tx`delete from item_sources where item_id = ${i.item_id}`;
      await tx`delete from item_audio where item_id = ${i.item_id}`;
      for (const c of i.competency_ids) await tx`insert into item_competencies values (${i.item_id}, ${c}, 'target') on conflict do nothing`;
      for (const c of i.prerequisite_ids) await tx`insert into item_competencies values (${i.item_id}, ${c}, 'prerequisite') on conflict do nothing`;
      for (const s of i.source_claim_ids) await tx`insert into item_sources values (${i.item_id}, ${s}) on conflict do nothing`;
      for (const a of i.audio_job_ids) await tx`insert into item_audio values (${i.item_id}, ${a}) on conflict do nothing`;
    }

    // 7. speaking scenarios
    for (const s of scenarios) {
      const p = s.payload;
      const { revisionId } = await revision('scenario', s.scenario_id, s.sha256, 'speaking', s, 'speaking_scenarios', 'scenario_id');
      await tx`insert into speaking_scenarios (scenario_id, level, domain, objective_ru, competency_ids, payload, current_hash, revision_id)
        values (${s.scenario_id}, ${p.cefr_level ?? null}, ${p.domain ?? null}, ${p.learning_objective ?? null}, ${p.primary_competencies ?? []}, ${tx.json(p)}, ${s.sha256}, ${revisionId})
        on conflict (scenario_id) do update set level = excluded.level, domain = excluded.domain, objective_ru = excluded.objective_ru,
          competency_ids = excluded.competency_ids, payload = excluded.payload, current_hash = excluded.current_hash, revision_id = excluded.revision_id`;
    }

    // 7b. Real Greek speaking roleplays (RG-S01..): converted to the same node graph, flagged unscored.
    const rgSpeakDir = 'GreekOS_Real_Greek/speaking';
    for (const f of readdirSync(join(root, rgSpeakDir)).filter((x) => /^RG-S\d+\.json$/.test(x)).sort()) {
      const path = `${rgSpeakDir}/${f}`;
      const rec = rd(path);
      const h = fileSha(path);
      const branches = (rec.branches ?? []) as Array<{ condition: string; ai_next_el: string }>;
      const payload = {
        scenario_id: rec.scenario_id, module: 'real_greek', unscored: true, cefr_level: 'A2', domain: 'Живой греческий', learning_objective: rec.learner_task,
        entry_node: 'OPEN', expression_ids: rec.expression_ids ?? [], original_record: rec,
        nodes: [
          { node_id: 'OPEN', assistant_el: rec.start_el, learner_goal_ru: rec.learner_task, acceptable_examples_el: rec.acceptable_example_not_exhaustive ? [rec.acceptable_example_not_exhaustive] : [], transitions: branches.map((b, i) => ({ condition: b.condition, to: `B${i + 1}` })) },
          ...branches.map((b, i) => ({ node_id: `B${i + 1}`, assistant_el: b.ai_next_el, learner_goal_ru: rec.learner_task, acceptable_examples_el: [], transitions: [] })),
        ],
        rubric: { scoring: rec.scoring_evidence ?? null, phonology: rec.phonology_scoring ?? 'NO_SCORE_WITHOUT_AUDIO' },
        status: 'DRAFT',
      };
      const { revisionId } = await revision('scenario', rec.scenario_id, h, 'real_greek', { path, payload }, 'speaking_scenarios', 'scenario_id');
      await tx`insert into speaking_scenarios (scenario_id, level, domain, objective_ru, competency_ids, payload, current_hash, revision_id)
        values (${rec.scenario_id}, 'A2', 'Живой греческий', ${rec.learner_task}, ${[]}, ${tx.json(payload)}, ${h}, ${revisionId})
        on conflict (scenario_id) do update set level = excluded.level, domain = excluded.domain, objective_ru = excluded.objective_ru,
          payload = excluded.payload, current_hash = excluded.current_hash, revision_id = excluded.revision_id`;
    }

    // 8. exams (forms F01–F03 and their 15 components)
    for (const f of exams.forms) {
      const assembly = rd(f.assembly_path);
      const payload = { ...f, assembly, editor_markdown: readFileSync(join(root, f.editor_path), 'utf8') };
      const { revisionId } = await revision('exam_form', f.form_id, f.assembly_sha256, 'keg_b2', payload, 'exam_forms', 'form_id');
      await tx`insert into exam_forms (form_id, payload, current_hash, revision_id) values (${f.form_id}, ${tx.json(payload)}, ${f.assembly_sha256}, ${revisionId})
        on conflict (form_id) do update set payload = excluded.payload, current_hash = excluded.current_hash, revision_id = excluded.revision_id`;
      for (const c of f.components) {
        const form = rd(c.form_path);
        const cpayload = { ...c, form };
        const logical = c.form_id === 'KEG-B2-P01' ? 'KEG-B2-W01' : c.form_id;
        const { revisionId: crev } = await revision('exam_component', c.form_id, c.form_sha256, 'keg_b2', cpayload, 'exam_components', 'component_id');
        await tx`insert into exam_components (component_id, form_id, logical_id, component_kind, duration_minutes, item_ids, text_ids, payload, current_hash, revision_id)
          values (${c.form_id}, ${f.form_id}, ${logical}, ${componentKind(c.form_id)}, ${typeof form.duration === 'number' ? form.duration : null},
            ${c.item_ids}, ${form.text_ids ?? []}, ${tx.json(cpayload)}, ${c.form_sha256}, ${crev})
          on conflict (component_id) do update set form_id = excluded.form_id, logical_id = excluded.logical_id, component_kind = excluded.component_kind,
            duration_minutes = excluded.duration_minutes, item_ids = excluded.item_ids, text_ids = excluded.text_ids, payload = excluded.payload,
            current_hash = excluded.current_hash, revision_id = excluded.revision_id`;
      }
    }

    // 9. Real Greek expressions, ΠΕΓΠ packets and protocol singletons
    for (const f of rgFiles) {
      const p = `${rgDir}/${f}`;
      const payload = rd(p);
      const h = fileSha(p);
      const { revisionId } = await revision('rg_expression', payload.id, h, 'real_greek', payload, 'rg_expressions', 'expression_id');
      await tx`insert into rg_expressions (expression_id, expression, payload, current_hash, revision_id) values (${payload.id}, ${payload.expression}, ${tx.json(payload)}, ${h}, ${revisionId})
        on conflict (expression_id) do update set expression = excluded.expression, payload = excluded.payload, current_hash = excluded.current_hash, revision_id = excluded.revision_id`;
    }
    const pegpFiles = [
      ...pegpThematic.map((f) => ({ path: `GreekOS_PEGP_Module/${f}`, kind: 'thematic' })),
      ...pegpLanguage.map((f) => ({ path: `GreekOS_PEGP_Module/language_support/${f}`, kind: 'language_support' })),
    ];
    for (const { path, kind } of pegpFiles) {
      const payload = rd(path);
      const id: string = path.split('/').pop()!.replace(/\.json$/, '');
      const topic = (id.match(/P0\d/) ?? [null])[0];
      const h = fileSha(path);
      const { revisionId } = await revision('pegp_packet', id, h, 'pegp', payload, 'pegp_packets', 'packet_id');
      await tx`insert into pegp_packets (packet_id, topic_code, packet_kind, payload, current_hash, revision_id) values (${id}, ${topic}, ${kind}, ${tx.json(payload)}, ${h}, ${revisionId})
        on conflict (packet_id) do update set topic_code = excluded.topic_code, packet_kind = excluded.packet_kind, payload = excluded.payload, current_hash = excluded.current_hash, revision_id = excluded.revision_id`;
    }
    for (const [sid, p] of Object.entries(singletonFiles)) {
      const payload = rd(p);
      const h = fileSha(p);
      const { revisionId } = await revision('singleton', sid, h, null, { path: p, payload }, 'content_singletons', 'singleton_id');
      await tx`insert into content_singletons (singleton_id, payload, current_hash, revision_id) values (${sid}, ${tx.json({ path: p, payload })}, ${h}, ${revisionId})
        on conflict (singleton_id) do update set payload = excluded.payload, current_hash = excluded.current_hash, revision_id = excluded.revision_id`;
    }

    // Post-conditions inside the transaction (roll back on failure).
    const [{ n_items }] = await tx`select count(*)::int as n_items from items where module <> 'synthetic_fixture'`;
    const [{ n_units }] = await tx`select count(*)::int as n_units from units`;
    if (n_items !== 1843 || n_units !== 87) throw new Error(`post-condition failed: items=${n_items} units=${n_units}`);
    const [{ released }] = await tx`select count(*)::int as released from app_private.current_item_release where text_released and module <> 'synthetic_fixture'`;

    await tx`update import_runs set status = 'COMMITTED', finished_at = now(), counts = ${tx.json(stats)},
      report = ${tx.json({ checks, counts: summary.counts, released_items_after_import: released })} where id = ${runId}`;
    return { runId, n_items, n_units, released };
  });
  console.log('Import COMMITTED', JSON.stringify(result));
  console.log(JSON.stringify(stats));
  writeReport({ status: 'COMMITTED', run: result, stats });
} catch (e) {
  console.error('Import FAILED and was rolled back:', e instanceof Error ? e.message : e);
  writeReport({ status: 'FAILED', error: String(e) });
  process.exitCode = 1;
} finally {
  await sql.end();
}
