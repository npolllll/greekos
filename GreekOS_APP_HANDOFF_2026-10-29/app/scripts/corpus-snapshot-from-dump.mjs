/**
 * Builds the corpus snapshot the unit tests read (.corpus-snapshot) straight from the content dump in the
 * repository (database/02_content_data.sql), without a database — for CI. Same shape as
 * scripts/export-corpus-snapshot.ts (which reads an imported database): items, audio jobs, exam forms
 * with their components, content singletons and Real Greek expressions, as originally imported.
 *
 *   node scripts/corpus-snapshot-from-dump.mjs [--dump ../database/02_content_data.sql] [--out .corpus-snapshot]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const dump = readFileSync(resolve(arg('--dump', '../database/02_content_data.sql')), 'utf8').split('\n');
const out = resolve(arg('--out', '.corpus-snapshot'));
const write = (rel, data) => { const p = join(out, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`); };

/** Rows of one COPY ... FROM stdin block (text format), as objects keyed by column. */
function table(name) {
  const start = dump.findIndex((l) => l.startsWith(`COPY public.${name} (`));
  if (start < 0) throw new Error(`no COPY block for ${name}`);
  const cols = dump[start].slice(dump[start].indexOf('(') + 1, dump[start].indexOf(')')).split(',').map((c) => c.trim());
  const rows = [];
  for (let i = start + 1; i < dump.length && dump[i] !== '\\.'; i++) {
    const vals = dump[i].split('\t').map((v) => (v === '\\N' ? null : v.replace(/\\(.)/g, (_, c) => ({ t: '\t', n: '\n', r: '\r', b: '\b', f: '\f', v: '\v', '\\': '\\' })[c] ?? c)));
    rows.push(Object.fromEntries(cols.map((c, k) => [c, vals[k]])));
  }
  return rows;
}
const json = (s) => JSON.parse(s);

const items = table('items').sort((a, b) => a.item_id.localeCompare(b.item_id));
write('HANDOFF_IMPORT/items.json', items.map((i) => json(i.envelope)));
const jobs = table('audio_jobs').sort((a, b) => a.audio_id.localeCompare(b.audio_id));
write('HANDOFF_IMPORT/audio_jobs.json', jobs.map((j) => json(j.payload)));
const forms = table('exam_forms').sort((a, b) => a.form_id.localeCompare(b.form_id));
const comps = table('exam_components');
write('HANDOFF_IMPORT/exams.json', {
  reconstructed_from_database: true,
  forms: forms.map((f) => {
    const { assembly: _a, editor_markdown: _e, components: raw, ...rest } = json(f.payload);
    const order = (raw ?? []).map((c) => c.form_id);
    const own = comps.filter((c) => c.form_id === f.form_id).sort((a, b) => order.indexOf(a.component_id) - order.indexOf(b.component_id));
    return { ...rest, components: own.map((c) => { const { form: _f, ...cp } = json(c.payload); return cp; }) };
  }),
});
const singletons = table('content_singletons');
for (const s of singletons) { const v = json(s.payload); if (v.path && v.payload !== undefined) write(v.path, v.payload); }
const rg = table('rg_expressions');
for (const r of rg) write(`GreekOS_Real_Greek/expressions/${r.expression_id}.json`, json(r.payload));
const manifest = { created_at: new Date().toISOString(), source: 'database/02_content_data.sql (imported canonical corpus)', items: items.length, audio_jobs: jobs.length, exam_forms: forms.length, exam_components: comps.length, singletons: singletons.length, rg_expressions: rg.length, not_available: ['SPEC/ADAPTIVE_FIXTURES.json', 'SPEC/FINALIZATION_ACCEPTANCE_FIXTURES.json'] };
write('SNAPSHOT_MANIFEST.json', manifest);
console.log(JSON.stringify(manifest));
