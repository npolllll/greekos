/**
 * Rebuilds the parts of the canonical corpus that unit tests read, from the imported database, when
 * the original corpus folder (CORPUS_ROOT, ../spec/GreekOS_CLAUDE_UPLOAD_READY) is not available —
 * e.g. on a machine that received only the database dump.
 *
 *   npx tsx scripts/export-corpus-snapshot.ts [--out .corpus-snapshot]
 *
 * Items and audio jobs are stored whole by the importer, so each exported object is checked against
 * its imported content hash; anything that does not match aborts the export. SPEC fixtures
 * (ADAPTIVE / FINALIZATION) are not in the database: tests that need them are skipped, never faked.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

if (existsSync(resolve('.env.local'))) {
  for (const line of readFileSync(resolve('.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
const { adminClient, selectAll } = await import('../src/lib/supabase/admin.ts');
const { contentHash } = await import('../src/lib/content/stable-json.ts');

const argOut = process.argv.indexOf('--out');
const out = resolve(argOut > 0 ? process.argv[argOut + 1] : '.corpus-snapshot');
const db = adminClient();
const write = (rel: string, data: unknown) => {
  const p = join(out, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`);
};
const problems: string[] = [];

const items = await selectAll<{ item_id: string; envelope: Record<string, unknown>; current_hash: string }>((f, t) => db.from('items').select('item_id, envelope, current_hash').order('item_id').range(f, t));
for (const i of items) if (contentHash(i.envelope) !== i.current_hash) problems.push(`item ${i.item_id}: hash differs from import`);
write('HANDOFF_IMPORT/items.json', items.map((i) => i.envelope));

const { data: jobs } = await db.from('audio_jobs').select('audio_id, payload, current_hash').order('audio_id');
for (const j of jobs ?? []) if (contentHash(j.payload) !== j.current_hash) problems.push(`audio_job ${j.audio_id}: hash differs from import`);
write('HANDOFF_IMPORT/audio_jobs.json', (jobs ?? []).map((j) => j.payload));

// exams.json: forms as imported, minus the assembly/editor files and per-component form files the importer inlined.
const [{ data: forms }, { data: comps }] = await Promise.all([
  db.from('exam_forms').select('form_id, payload').order('form_id'),
  db.from('exam_components').select('component_id, form_id, payload').order('component_id'),
]);
write('HANDOFF_IMPORT/exams.json', {
  reconstructed_from_database: true,
  forms: (forms ?? []).map((f) => {
    const { assembly: _a, editor_markdown: _e, components: rawComponents, ...rest } = f.payload as Record<string, unknown> & { components?: Array<{ form_id: string }> };
    const order = (rawComponents ?? []).map((c) => c.form_id);
    const own = (comps ?? []).filter((c) => c.form_id === f.form_id).sort((a, b) => order.indexOf(a.component_id) - order.indexOf(b.component_id));
    return { ...rest, components: own.map((c) => { const { form: _f, ...cp } = c.payload as Record<string, unknown>; return cp; }) };
  }),
});

const { data: singletons } = await db.from('content_singletons').select('singleton_id, payload');
for (const s of singletons ?? []) {
  const v = s.payload as { path?: string; payload?: unknown };
  if (v.path && v.payload !== undefined) write(v.path, v.payload);
}

const { data: rg } = await db.from('rg_expressions').select('expression_id, payload').order('expression_id');
for (const r of rg ?? []) write(`GreekOS_Real_Greek/expressions/${r.expression_id}.json`, r.payload);

const manifest = {
  created_at: new Date().toISOString(), source: 'database (imported canonical corpus)', items: items.length, audio_jobs: jobs?.length ?? 0,
  exam_forms: forms?.length ?? 0, exam_components: comps?.length ?? 0, singletons: singletons?.length ?? 0, rg_expressions: rg?.length ?? 0,
  hash_check: problems.length ? 'FAILED' : 'PASS', problems, not_available: ['SPEC/ADAPTIVE_FIXTURES.json', 'SPEC/FINALIZATION_ACCEPTANCE_FIXTURES.json'],
};
write('SNAPSHOT_MANIFEST.json', manifest);
console.log(JSON.stringify(manifest, null, 2));
if (problems.length) process.exit(1);
