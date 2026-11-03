/**
 * False-hit check of the course grammar rules (src/lib/speaking/grammar-rules.ts): every rule runs over
 * the course's own vetted Greek — unit examples and reading texts, scenario lines and example answers,
 * item answers and model responses (error-correction items, which contain deliberate mistakes, are
 * skipped). A hit there is either a false rule or a corpus defect; the report lists each one.
 *
 *   npx tsx --conditions=react-server scripts/rules-on-corpus.ts [--out reports/v7/rules]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { adminClient, selectAll } from '../src/lib/supabase/admin.ts';
import { candidates, courseRuleFindings, primeLexicon } from '../src/lib/speaking/grammar-rules.ts';

const out = (() => { const i = process.argv.indexOf('--out'); return i > 0 ? process.argv[i + 1] : 'reports/v7/rules'; })();
const INTENTIONAL = /исправ|ошибк|лишн|найдите неверн|ударени|поставьте знак/i;
const greek = (s: unknown): string[] => {
  if (typeof s === 'string') return /\p{Script=Greek}{2,}/u.test(s) ? [s] : [];
  if (Array.isArray(s)) return s.flatMap(greek);
  if (s && typeof s === 'object') return Object.values(s).flatMap(greek);
  return [];
};

async function main() {
  const db = adminClient();
  const texts: Array<{ src: string; text: string }> = [];
  const { data: units } = await db.from('units').select('unit_id, teaching');
  for (const u of units ?? []) {
    const t = (u.teaching ?? {}) as Record<string, unknown>;
    for (const k of ['examples_el', 'reading_text_el', 'reading_texts_el', 'vocabulary_items']) for (const x of greek(t[k])) texts.push({ src: `${u.unit_id}.${k}`, text: x });
  }
  const { data: scen } = await db.from('speaking_scenarios').select('scenario_id, payload');
  for (const s of scen ?? []) {
    const p = s.payload as { nodes?: Array<{ node_id: string; assistant_el?: string; acceptable_examples_el?: string[] }> };
    for (const n of p.nodes ?? []) for (const x of greek([n.assistant_el, n.acceptable_examples_el])) texts.push({ src: `${s.scenario_id}.${n.node_id}`, text: x });
  }
  const items = await selectAll<{ item_id: string; envelope: Record<string, unknown> }>((f, t) => db.from('items').select('item_id, envelope').order('item_id').range(f, t));
  for (const it of items) {
    const e = it.envelope;
    if (INTENTIONAL.test(String(e.prompt ?? '')) || /error|correct/i.test(String(e.type ?? ''))) continue;
    for (const x of greek([e.answer, e.accepted_alternatives, e.model_response])) texts.push({ src: it.item_id, text: x });
  }
  // Split into sentences so one hunspell call checks a manageable chunk.
  const sentences = texts.flatMap(({ src, text }) => text.split(/(?<=[.!?;])\s+/u).filter((x) => /\p{Script=Greek}{2,}/u.test(x)).map((x) => ({ src, text: x })));
  // One dictionary pass for every form the rules may ask about.
  await primeLexicon(candidates(sentences.flatMap((s) => s.text.match(/[\p{L}\p{M}]+/gu) ?? [])));
  const hits: Array<{ src: string; text: string; rule: string; quote: string; better_el: string }> = [];
  for (const s of sentences) for (const f of await courseRuleFindings(s.text)) hits.push({ src: s.src, text: s.text, rule: f.rule, quote: f.quote, better_el: f.better_el });
  const byRule = hits.reduce<Record<string, number>>((a, h) => { a[h.rule] = (a[h.rule] ?? 0) + 1; return a; }, {});
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'RULES_ON_CORPUS.json'), JSON.stringify({ generated_at: new Date().toISOString(), sentences: sentences.length, hits: hits.length, by_rule: byRule, list: hits }, null, 2));
  writeFileSync(join(out, 'RULES_ON_CORPUS.md'), [
    '# Правила курса на выверенном греческом корпуса', '',
    `Предложений: ${sentences.length}. Срабатываний: **${hits.length}** (${Object.entries(byRule).map(([k, v]) => `${k}: ${v}`).join(', ') || '—'}).`, '',
    'Срабатывание на выверенном тексте — либо ложное правило (исправлено в правилах), либо дефект корпуса.', '',
    '| Источник | Правило | Фрагмент | Предложение правила | Текст |', '|---|---|---|---|---|',
    ...hits.map((h) => `| ${h.src} | ${h.rule} | ${h.quote} | ${h.better_el} | ${h.text.replace(/\|/g, '/')} |`), '',
  ].join('\n'));
  console.log(JSON.stringify({ sentences: sentences.length, hits: hits.length, by_rule: byRule }, null, 2));
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
