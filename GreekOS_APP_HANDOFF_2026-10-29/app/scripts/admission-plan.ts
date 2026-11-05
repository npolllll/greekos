/**
 * Reproducible corpus admission plan: what the owner can admit after signing the digital policy and
 * taking the batch decision in Admin → Цифровой QA, and what stays blocked and why. It decides
 * nothing and releases nothing; it reads the latest full QA batch (or runs a fresh one with --fresh).
 *
 *   npx tsx --conditions=react-server scripts/admission-plan.ts [--fresh] [--out reports/v6/admission]
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { adminClient, selectAll } from '../src/lib/supabase/admin.ts';
import { runQaBatch } from '../src/lib/qa/run.ts';

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const out = arg('--out') ?? 'reports/v6/admission';

async function main() {
  const db = adminClient();
  let batchId: string;
  if (process.argv.includes('--fresh')) {
    const r = await runQaBatch({ actorId: null, label: 'План допуска: полный прогон' });
    batchId = (r as { batch_id?: string; id?: string }).batch_id ?? (r as { id?: string }).id!;
  } else {
    const { data } = await db.from('qa_batches').select('id, scope, started_at').eq('status', 'COMPLETED').order('started_at', { ascending: false }).limit(50);
    batchId = (data ?? []).find((b) => (b.scope as { kind?: string })?.kind === 'all')!.id;
  }
  const { data: batch } = await db.from('qa_batches').select('id, label, started_at, report_sha256').eq('id', batchId).single();
  const results = await selectAll<{ content_kind: string; content_id: string; content_hash: string; unit_id: string | null; module: string | null; verdict: string; blocking_count: number }>((f, t) => db.from('qa_item_results').select('content_kind, content_id, content_hash, unit_id, module, verdict, blocking_count').eq('batch_id', batchId).order('content_id').range(f, t));
  const items = await selectAll<{ item_id: string; module: string; unit_id: string | null; level: string | null; current_hash: string; requires_audio: boolean; audio_job_ids: string[] }>((f, t) => db.from('items').select('item_id, module, unit_id, level, current_hash, requires_audio, audio_job_ids').order('item_id').range(f, t));
  const { data: units } = await db.from('units').select('unit_id, level, title_ru, current_hash').order('unit_id');
  const { data: assets } = await db.from('audio_assets').select('audio_id, digital_status, rights_status, cast_approved').is('invalidated_at', null);
  const { data: openIssues } = await db.from('qa_issues').select('content_id, check_id').eq('batch_id', batchId).eq('severity', 'blocking').eq('status', 'open');
  const { data: policy } = await db.from('publication_policies').select('id, signed_at, revoked_at').is('revoked_at', null).order('signed_at', { ascending: false }).limit(1).maybeSingle();
  const { data: releases } = await db.from('content_releases').select('content_kind, content_id, content_hash').is('revoked_at', null);
  const released = new Set((releases ?? []).map((r) => `${r.content_kind}|${r.content_id}|${r.content_hash}`));
  const res = new Map(results.map((r) => [`${r.content_kind}|${r.content_id}`, r]));
  const audioReady = new Map<string, 'distributable' | 'dev_only' | 'needs_review' | 'missing'>();
  for (const a of assets ?? []) audioReady.set(a.audio_id, a.digital_status === 'AUDIO_VERIFIED_DIGITAL' ? (a.rights_status === 'PROVIDER_TERMS_RECORDED' && a.cast_approved ? 'distributable' : 'dev_only') : 'needs_review');
  const blockers = new Map<string, string[]>();
  for (const i of openIssues ?? []) blockers.set(i.content_id, [...(blockers.get(i.content_id) ?? []), i.check_id]);

  const classify = (it: (typeof items)[number]) => {
    const r = res.get(`item|${it.item_id}`);
    if (released.has(`item|${it.item_id}|${it.current_hash}`)) return 'released';
    if (!r || r.content_hash !== it.current_hash) return 'stale_qa';
    if (r.verdict === 'FAIL') return 'blocked';
    if (r.verdict === 'NEEDS_REVIEW') return 'issue_review';
    if (it.requires_audio && it.audio_job_ids.length && !it.audio_job_ids.every((a) => audioReady.get(a) === 'distributable')) return 'text_ready_audio_pending';
    return 'ready';
  };
  const rows = items.map((it) => ({ ...it, state: classify(it), blockers: blockers.get(it.item_id) ?? [] }));
  const by = <K extends string>(key: (r: (typeof rows)[number]) => K) => {
    const m = new Map<K, Record<string, number>>();
    for (const r of rows) { const k = key(r); const c = m.get(k) ?? {}; c[r.state] = (c[r.state] ?? 0) + 1; m.set(k, c); }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  };
  const unitRows = (units ?? []).map((u) => {
    const its = rows.filter((r) => r.unit_id === u.unit_id);
    const ur = res.get(`unit|${u.unit_id}`);
    const unitState = !ur || ur.content_hash !== u.current_hash ? 'stale_qa' : ur.verdict === 'FAIL' ? 'blocked' : ur.verdict === 'NEEDS_REVIEW' ? 'issue_review' : 'ready';
    const ready = its.filter((r) => r.state === 'ready' || r.state === 'text_ready_audio_pending').length;
    return { unit_id: u.unit_id, level: u.level, title: u.title_ru, unit_state: unitState, items: its.length, admissible_items: ready, audio_pending: its.filter((r) => r.state === 'text_ready_audio_pending').length, review: its.filter((r) => r.state === 'issue_review').length, blocked: its.filter((r) => r.state === 'blocked').length, blockers: [...new Set(its.flatMap((r) => r.blockers))] };
  });
  const totals = rows.reduce<Record<string, number>>((a, r) => { a[r.state] = (a[r.state] ?? 0) + 1; return a; }, {});
  const plan = {
    generated_at: new Date().toISOString(), qa_batch: batch, policy_signed: !!policy, totals, by_module: by((r) => r.module), by_level: by((r) => (r.module === 'core' ? r.level ?? '—' : r.module)), units: unitRows,
    blocked_items: rows.filter((r) => r.state === 'blocked').map((r) => ({ item_id: r.item_id, blockers: r.blockers })),
    note: 'План ничего не выпускает. Допуск: владелец подписывает цифровую политику и принимает решение по пакету QA в админке; HUMAN_* статусы не присваиваются.',
  };
  mkdirSync(out, { recursive: true });
  const json = JSON.stringify(plan, null, 2);
  writeFileSync(join(out, 'ADMISSION_PLAN.json'), json);
  const st = (c: Record<string, number>) => ['ready', 'text_ready_audio_pending', 'issue_review', 'blocked', 'stale_qa', 'released'].map((k) => c[k] ?? 0).join(' | ');
  const md = [
    '# План допуска корпуса',
    '',
    `Пакет QA \`${batch!.id}\` (${batch!.label}, ${batch!.started_at}), SHA-256 отчёта \`${batch!.report_sha256 ?? '—'}\`. Политика подписана: **${policy ? 'да' : 'нет'}**. SHA-256 плана: \`${createHash('sha256').update(json).digest('hex')}\`.`,
    '',
    plan.note,
    '',
    '| Группа | готово | текст готов, аудио нет | замечания на разбор | заблокировано | QA устарел | выпущено |',
    '|---|---|---|---|---|---|---|',
    `| **Всего** | ${st(totals)} |`,
    ...plan.by_level.map(([k, c]) => `| ${k} | ${st(c)} |`),
    '',
    '## Уроки',
    '',
    '| Урок | Уровень | Состояние урока | Заданий | можно допустить | из них ждут аудио | на разбор | заблокировано | блокеры |',
    '|---|---|---|---|---|---|---|---|---|',
    ...unitRows.map((u) => `| ${u.unit_id} ${u.title ?? ''} | ${u.level ?? ''} | ${u.unit_state} | ${u.items} | ${u.admissible_items} | ${u.audio_pending} | ${u.review} | ${u.blocked} | ${u.blockers.join(', ') || '—'} |`),
    '',
    `## Заблокированные задания (${plan.blocked_items.length})`,
    '',
    ...plan.blocked_items.map((b) => `- ${b.item_id}: ${b.blockers.join(', ') || 'FAIL'}`),
    '',
  ].join('\n');
  writeFileSync(join(out, 'ADMISSION_PLAN.md'), md);
  console.log(JSON.stringify({ out, totals, policy_signed: !!policy, units: unitRows.length }, null, 2));
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
