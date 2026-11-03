/**
 * Live latency of the AI interlocutor on this machine, through the same service code as a session:
 * a scripted learner plays a scene turn by turn with realistic pauses (the persona's reply is voiced,
 * the learner listens and speaks), and every turn reports when the first validated sentence was ready.
 * The model server's own log shows how many prompt tokens each request reused from the KV cache.
 *
 *   npx tsx --conditions=react-server scripts/speaking-latency.ts [--scenario SC05] [--listen-ms 6000] [--out reports/v7/speaking-latency]
 *
 * Uses a temporary synthetic owner account (deleted at the end); writes nothing to course content.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { adminClient } from '../src/lib/supabase/admin.ts';
import { startSession, learnerTurn, endSession, warmSession } from '../src/lib/speaking/service.ts';
import { llmInfo } from '../src/lib/providers/llm.ts';
import { env } from '../src/lib/env.ts';
import type { SessionUser } from '../src/lib/session-user.ts';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const scenario = arg('--scenario', 'SC05');
const listenMs = Number(arg('--listen-ms', '6000'));
const out = arg('--out', 'reports/v7/speaking-latency');

const LINES: Record<string, string[]> = {
  SC05: ['Θέλω ένα καφέ και ένα νερό, παρακαλώ.', 'Ναι, μεγάλο, ευχαριστώ.', 'Θα μείνω εδώ. Περιμένω μια φίλη.', 'Στις πέντε. Πόσο κάνει;', 'Ευχαριστώ πολύ!'],
  SC01: ['Καλημέρα. Θέλω ένα κιλό μήλα, παρακαλώ.', 'Εντάξει, μισό κιλό αχλάδια.', 'Πόσο κάνουν όλα μαζί;', 'Ορίστε. Ευχαριστώ!'],
  SC24: ['Μένω στη Θεσσαλονίκη δύο χρόνια.', 'Μου αρέσει η θάλασσα και το φαγητό.', 'Το Σαββατοκύριακο πάω στην παραλία.', 'Ναι, με τους φίλους μου.'],
};
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };

async function main() {
  if (env.appEnv !== 'local') throw new Error('Только локальная среда (APP_ENV=local).');
  const db = adminClient();
  const email = `latency-${randomUUID().slice(0, 8)}@greekos.test`;
  const { data, error } = await db.auth.admin.createUser({ email, password: randomBytes(18).toString('base64url'), email_confirm: true });
  if (error) throw error;
  const id = data.user.id;
  await db.from('profiles').insert({ user_id: id, display_name: 'Latency probe', email, timezone: 'Europe/Athens', active: true, lifecycle_state: 'studying', entry_path: 'from_zero' });
  await db.from('role_assignments').insert({ user_id: id, role: 'owner_admin' });
  await db.from('enrollments').insert({ user_id: id, start_date: '2026-10-01', timezone: 'Europe/Athens' });
  const user: SessionUser = { userId: id, email, isOwner: true, devPreview: false, profile: { user_id: id, display_name: 'Latency probe', email, timezone: 'Europe/Athens', active: true, entry_path: 'from_zero', lifecycle_state: 'studying', invited_at: null, activated_at: null } } as SessionUser;
  const rows: Array<Record<string, unknown>> = [];
  try {
    const mode = scenario === 'SC24' ? 'free_talk' : 'roleplay';
    const v = await startSession(user, { scenario_id: scenario, mode, input_mode: 'text_fallback', idempotency_key: randomUUID() });
    // As in the app: the opening is warmed while the learner reads and listens to it.
    const warm = warmSession(user, v.session_id);
    await pause(listenMs);
    console.log('warm-up of the opening:', await warm, 'ms');
    for (const line of LINES[scenario] ?? LINES.SC05) {
      const t0 = Date.now();
      let firstAt: number | null = null;
      const res = await learnerTurn(user, { session_id: v.session_id, text: line, source: 'typed', asr_confidence: null, help_used: [], repair: false, interrupted_previous: false, idempotency_key: randomUUID() }, { onSentence: () => { firstAt ??= Date.now() - t0; } });
      const total = Date.now() - t0;
      const a = res.turns.at(-1)!;
      rows.push({ learner: line, reply: a.text, engine: res.engine_kind, first_sentence_ms: firstAt, model_first_ms: res.gen_first_ms, turn_ms: total, node: res.current_node });
      console.log(`${res.engine_kind} first=${firstAt}ms turn=${total}ms | ${line} → ${a.text}`);
      if (res.ended_node) break;
      // The reply is voiced (≈ 1.5 s per sentence), then warm-up and phrase feedback run while the
      // learner listens and answers.
      await pause(1500);
      const after = res.afterReply();
      await pause(listenMs);
      await after;
    }
    await endSession(user, v.session_id).catch(() => null);
  } finally {
    await db.auth.admin.deleteUser(id);
  }
  const firsts = rows.map((r) => Number(r.first_sentence_ms)).filter(Boolean);
  const turns = rows.map((r) => Number(r.turn_ms));
  const report = {
    measured_at: new Date().toISOString(), scenario, model: llmInfo().model, machine: `${os.cpus()[0]?.model ?? 'cpu'} × ${os.cpus().length}, ${Math.round(os.totalmem() / 2 ** 30)} GB, ${os.platform()}/${os.arch()}`,
    listen_ms: listenMs, first_sentence_p50_ms: pct(firsts, 0.5), first_sentence_max_ms: firsts.length ? Math.max(...firsts) : null, turn_p50_ms: pct(turns, 0.5), rows,
    note: 'Время от отправки реплики ученика (после распознавания) до первого проверенного предложения ответа; без ASR и синтеза речи.',
  };
  mkdirSync(out, { recursive: true });
  const name = `${String(report.model ?? 'model')}-${scenario}`;
  writeFileSync(join(out, `${name}.json`), JSON.stringify(report, null, 2));
  writeFileSync(join(out, `${name}.md`), [
    `# Задержка AI-собеседника — ${scenario}, ${report.model}`, '', `${report.machine}; пауза ученика ${listenMs} мс; ${report.measured_at}.`, '', report.note, '',
    `Первое предложение p50 / max: **${report.first_sentence_p50_ms} / ${report.first_sentence_max_ms} мс** · ход целиком p50: ${report.turn_p50_ms} мс`, '',
    '| Ученик | Ответ | Движок | Первое предложение | Ход |', '|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.learner} | ${r.reply} | ${r.engine} | ${r.first_sentence_ms ?? '—'} мс | ${r.turn_ms} мс |`), '',
  ].join('\n'));
  console.log(JSON.stringify({ scenario, first_sentence_p50_ms: report.first_sentence_p50_ms, first_sentence_max_ms: report.first_sentence_max_ms, turn_p50_ms: report.turn_p50_ms }));
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
