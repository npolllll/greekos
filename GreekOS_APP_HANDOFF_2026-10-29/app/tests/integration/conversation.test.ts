import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { admin, createUser, deleteUser, type TestUser } from './helpers';
import { startSession, learnerTurn, endSession } from '@/lib/speaking/service';
import { streamJson } from '@/lib/providers/llm-stream';

/**
 * Conversation engine v2 against the real local database, with the LLM replaced by local servers
 * that speak the providers' wire protocols (OpenAI-compatible SSE; Anthropic Messages SSE). These are
 * contract tests of request/response handling — they say nothing about a real model's quality.
 */
type Req = { path: string; headers: http.IncomingHttpHeaders; body: Record<string, any> };
const requests: Req[] = [];
let turnJson = '';
let feedbackJson = '';
let chunkDelayMs = 3;
let server: http.Server;
let base = '';
let owner: TestUser;
const saved: Record<string, string | undefined> = {};

function sse(res: http.ServerResponse, chunks: string[], model: string) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  let i = 0;
  const tick = () => {
    if (res.destroyed) return;
    if (i < chunks.length) {
      res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', model, choices: [{ index: 0, delta: { content: chunks[i++] }, finish_reason: null }] })}\n\n`);
      setTimeout(tick, chunkDelayMs);
    } else {
      res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20 } })}\n\n`);
      res.end('data: [DONE]\n\n');
    }
  };
  tick();
}

const pieces = (t: string) => t.match(/[\s\S]{1,6}/g) ?? [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      requests.push({ path: req.url ?? '', headers: req.headers, body });
      if (req.url === '/v1/messages') {
        // Anthropic Messages streaming wire format.
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const ev = (type: string, data: unknown) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
        ev('message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, usage: { input_tokens: 42, output_tokens: 0 } } });
        ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
        for (const p of pieces('{"reply_el":"Γεια σας! Τι θα θέλατε;"}')) ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: p } });
        ev('content_block_stop', { type: 'content_block_stop', index: 0 });
        ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 12 } });
        ev('message_stop', { type: 'message_stop' });
        res.end();
        return;
      }
      const props = body.response_format?.json_schema?.schema?.properties ?? {};
      if (!body.stream) {
        // Authored engine (unqualified model): transition classification, non-streaming.
        const content = JSON.stringify({ intent: 'on_task', transition_to: 'TWIST', assistant_el: 'Ναι.', hint_ru: null, communication_breakdown: false });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ model: body.model, choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 20 } }));
        return;
      }
      if ('has_issue' in props) return sse(res, pieces(feedbackJson), body.model);
      if ('stage' in props) return sse(res, pieces(turnJson), body.model);
      return sse(res, ['{"reply_el":"'], body.model); // prefill
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const k of ['LLM_PROVIDER', 'LLM_BASE_URL', 'LLM_MODEL', 'LLM_QUALIFICATION_FILE', 'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'APP_ENV', 'LLM_TURN_TIMEOUT_MS']) saved[k] = process.env[k];
  process.env.APP_ENV = 'local';
  process.env.LLM_PROVIDER = 'openai_compatible';
  process.env.LLM_BASE_URL = base;
  process.env.LLM_MODEL = 'mock-greek';
  process.env.LLM_TURN_TIMEOUT_MS = '10000';
  delete process.env.ANTHROPIC_API_KEY;
  const dir = mkdtempSync(join(tmpdir(), 'greekos-qual-'));
  process.env.LLM_QUALIFICATION_FILE = join(dir, 'qualification.json');
  qualify(true);
  owner = await createUser({ owner: true });
}, 60_000);

afterAll(async () => {
  server?.close();
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  if (owner) await deleteUser(owner);
});

function qualify(passed: boolean) {
  writeFileSync(process.env.LLM_QUALIFICATION_FILE!, JSON.stringify({ 'mock-greek': { model: 'mock-greek', suite: 'test', evaluated_at: new Date().toISOString(), cases: 1, passed, metrics: { reply_ok: 1, stage_ok: 1 }, thresholds: {} } }));
}

async function session(mode: 'roleplay' | 'free_talk' = 'roleplay') {
  const v = await startSession(owner.session, { scenario_id: 'SC01', mode, input_mode: 'text_fallback', idempotency_key: randomUUID() });
  return v.session_id;
}

const say = (sid: string, text: string, opts = {}) => learnerTurn(owner.session, { session_id: sid, text, source: 'typed', asr_confidence: null, help_used: [], repair: false, interrupted_previous: false, idempotency_key: randomUUID() }, opts);

describe('conversation engine v2 (wire-protocol mocks)', () => {
  it('streams a generated reply sentence by sentence, stores engine, memory and validated feedback', async () => {
    qualify(true);
    const sid = await session();
    turnJson = JSON.stringify({ stage: 'TWIST', reply_el: 'Δύο κιλά μήλα; Δυστυχώς τα μήλα τελείωσαν σήμερα. Έχουμε όμως αχλάδια με δύο ευρώ το κιλό.', intent: 'on_task', hint_ru: null, facts: ['Яблок нет', 'Груши 2 € за кг'] });
    feedbackJson = JSON.stringify({ has_issue: true, quote: 'δύο κιλό', better_el: 'δύο κιλά', why_ru: 'После числа больше одного — множественное число: κιλά.', kind: 'error' });
    const sentences: string[] = [];
    const before = requests.length;
    const res = await say(sid, 'Θέλω δύο κιλό μήλα.', { onSentence: (s: string) => sentences.push(s) });
    expect(res.engine_kind).toBe('llm');
    expect(sentences.length).toBeGreaterThanOrEqual(2);
    const a = res.turns.at(-1)!;
    expect(a.speaker).toBe('assistant');
    expect(a.text).toBe(sentences.join(' '));
    expect(a.engine).toBe('llm:mock-greek');
    expect(res.current_node).toBe('TWIST');
    expect(res.engine.kind).toBe('ai');
    // Wire contract: streamed, schema-constrained, stage before reply, session id as cache key.
    const turnReq = requests.slice(before).find((r) => r.body.response_format?.json_schema?.schema?.properties?.stage)!;
    expect(turnReq.body.stream).toBe(true);
    expect(Object.keys(turnReq.body.response_format.json_schema.schema.properties).slice(0, 2)).toEqual(['stage', 'reply_el']);
    expect(turnReq.body.user).toBe(sid);
    expect(turnReq.body.messages.at(-1).content).toContain('«Θέλω δύο κιλό μήλα.»');
    const { data: s } = await admin.from('speaking_sessions').select('memory').eq('session_id', sid).single();
    expect((s!.memory as { facts: string[] }).facts).toContain('Груши 2 € за кг');
    // Feedback arrives after the reply (background), validated against the learner's own words.
    const later = await res.background;
    const l = later!.turns.find((t) => t.speaker === 'learner')!;
    expect(l.feedback).toMatchObject({ status: 'ready', quote: 'δύο κιλό', better_el: 'δύο κιλά', kind: 'error' });
    // The next turn was pre-evaluated in the same conversation slot.
    expect(requests.slice(before).some((r) => r.body.max_tokens === 1 && r.body.user === sid)).toBe(true);
  });

  it('rejects a reply that fails the Greek guard and says so: authored line, labelled fallback', async () => {
    qualify(true);
    const sid = await session();
    turnJson = JSON.stringify({ stage: 'TWIST', reply_el: 'Хорошо, τα μήλα τελείωσαν.', intent: 'on_task', hint_ru: null, facts: [] });
    feedbackJson = JSON.stringify({ has_issue: false, quote: '', better_el: '', why_ru: '', kind: 'error' });
    const sentences: string[] = [];
    const res = await say(sid, 'Θέλω ένα κιλό μήλα.', { onSentence: (s: string) => sentences.push(s) });
    expect(sentences).toEqual([]);
    expect(res.engine_kind).toBe('scripted_fallback');
    expect(res.engine_reason).toMatch(/^GUARD:.*CYRILLIC/);
    const a = res.turns.at(-1)!;
    expect(a.engine).toBe('scripted_fallback');
    expect(a.generated).toBe(false);
    expect(res.current_node).toBe('TWIST'); // a Greek answer advances along the authored main path
    await res.background;
  });

  it('a hallucinated correction (quote not in the learner phrase) is dropped', async () => {
    qualify(true);
    const sid = await session();
    turnJson = JSON.stringify({ stage: 'TWIST', reply_el: 'Τα μήλα τελείωσαν σήμερα. Θέλετε αχλάδια;', intent: 'on_task', hint_ru: null, facts: [] });
    feedbackJson = JSON.stringify({ has_issue: true, quote: 'πορτοκάλια', better_el: 'πορτοκάλι', why_ru: 'x', kind: 'error' });
    const res = await say(sid, 'Θέλω ένα κιλό μήλα.');
    const later = await res.background;
    expect(later!.turns.find((t) => t.speaker === 'learner')!.feedback).toEqual({ status: 'none' });
  });

  it('barge-in stops generation: only what was produced before the stop is stored', async () => {
    qualify(true);
    const sid = await session();
    chunkDelayMs = 25;
    turnJson = JSON.stringify({ stage: 'TWIST', reply_el: 'Τα μήλα τελείωσαν σήμερα. Έχουμε όμως αχλάδια με δύο ευρώ το κιλό. Θέλετε να δοκιμάσετε μισό κιλό αχλάδια;', intent: 'on_task', hint_ru: null, facts: [] });
    const ac = new AbortController();
    const sentences: string[] = [];
    const res = await say(sid, 'Θέλω μήλα.', { signal: ac.signal, onSentence: (s: string) => { sentences.push(s); ac.abort(); } });
    chunkDelayMs = 3;
    expect(sentences).toHaveLength(1);
    expect(res.turns.at(-1)!.text).toBe(sentences[0]);
    expect(res.engine_kind).toBe('llm');
    await res.background;
  });

  it('an unqualified local model never generates the persona\'s Greek (authored engine)', async () => {
    qualify(false);
    const sid = await session();
    const before = requests.length;
    const res = await say(sid, 'Θέλω ένα κιλό μήλα.');
    expect(res.engine_kind).toBe('authored');
    expect(res.engine.kind).toBe('authored');
    expect(res.turns.at(-1)!.engine).toBe('authored');
    expect(requests.slice(before).some((r) => r.body.stream)).toBe(false);
    expect(res.turns.find((t) => t.speaker === 'learner')!.feedback).toBeNull();
    await res.background;
    qualify(true);
  });

  it('session end: the summary lists the validated points, no mastery change', async () => {
    qualify(true);
    const sid = await session();
    turnJson = JSON.stringify({ stage: 'TWIST', reply_el: 'Τα μήλα τελείωσαν σήμερα. Θέλετε αχλάδια;', intent: 'on_task', hint_ru: null, facts: [] });
    feedbackJson = JSON.stringify({ has_issue: true, quote: 'ένα καφέ', better_el: 'έναν καφέ', why_ru: 'Ο καφές — мужской род: έναν καφέ.', kind: 'error' });
    await (await say(sid, 'Θέλω ένα καφέ και μήλα.')).background;
    turnJson = JSON.stringify({ stage: 'NEGOTIATE', reply_el: 'Ωραία, μισό κιλό αχλάδια. Θα πληρώσετε με κάρτα;', intent: 'on_task', hint_ru: null, facts: [] });
    feedbackJson = JSON.stringify({ has_issue: false, quote: '', better_el: '', why_ru: '', kind: 'error' });
    await (await say(sid, 'Ναι, μισό κιλό αχλάδια.')).background;
    const v = await endSession(owner.session, sid);
    expect(v.summary).toMatchObject({ status: 'AI_FEEDBACK', mastery_counted: false, learner_turns: 2 });
    expect((v.summary as { corrections: Array<{ better_el: string }> }).corrections.map((c) => c.better_el)).toEqual(['έναν καφέ']);
  });

  it('free talk opens with a neutral line, not a scene\'s first line', async () => {
    const sid = await session('free_talk');
    const { data } = await admin.from('speaking_turns').select('text_el, engine').eq('session_id', sid).eq('seq', 0).single();
    expect(data).toEqual({ text_el: 'Γεια σας! Τι κάνετε; Πώς πάει η μέρα σας;', engine: 'authored' });
  });

  it('Anthropic Messages streaming contract: structured output requested, text deltas assembled', async () => {
    process.env.LLM_PROVIDER = 'anthropic';
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
    process.env.ANTHROPIC_BASE_URL = base;
    try {
      const chunks: string[] = [];
      const r = await streamJson({ userId: null, operation: 'contract_test', model: 'claude-test', system: 'S', messages: [{ role: 'user', content: 'U' }], schema: { type: 'object', properties: { reply_el: { type: 'string' } }, required: ['reply_el'], additionalProperties: false }, maxTokens: 50, timeoutMs: 10_000, onText: (c) => chunks.push(c) });
      expect(r.ok).toBe(true);
      if (r.ok) expect(JSON.parse(r.text)).toEqual({ reply_el: 'Γεια σας! Τι θα θέλατε;' });
      expect(chunks.length).toBeGreaterThan(1);
      const req = requests.findLast((x) => x.path === '/v1/messages')!;
      // SDK 1.x sends the API key as a bearer token.
      expect(req.headers.authorization).toBe('Bearer test-key-not-real');
      expect(req.body).toMatchObject({ model: 'claude-test', stream: true, system: 'S', output_config: { format: { type: 'json_schema' } } });
    } finally {
      process.env.LLM_PROVIDER = 'openai_compatible';
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_BASE_URL;
    }
  });
});
