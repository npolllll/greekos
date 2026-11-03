#!/usr/bin/env node
/**
 * GreekOS local LLM server — development only, binds 127.0.0.1. OpenAI-compatible subset:
 *   GET  /health, GET /v1/models
 *   POST /v1/chat/completions  {messages, max_tokens, temperature, stream?, response_format?}
 *        response_format {type:"json_schema", json_schema:{schema}} → grammar-constrained JSON.
 * Engine: node-llama-cpp (llama.cpp) with a local GGUF model; Metal on Apple Silicon, CPU elsewhere;
 * no network, no keys. Default model: Gemma 4 E2B instruct (Q4_K_M, OCI artifact docker.io/ai/gemma4),
 * chosen by the GreekOS speaking evaluation (scripts/speaking-eval.ts); on a Mac with ≥16 GB the
 * larger E4B can be selected with GREEKOS_LLM_MODEL.
 *
 * Conversation slots: each request's `user` field (the speaking session id; phrase feedback uses
 * `<id>:feedback`) keeps its own sequence. The next request of the same conversation evaluates only the
 * tokens after the longest common prefix with what the slot already holds (KV-cache reuse), and a
 * warm-up ("speaking_prefill") evaluates the next prompt up to the learner's words while they speak.
 * Requests of one slot run in order; different slots run in parallel (one batched context), so a
 * learner's turn never waits behind phrase feedback, and it pre-empts a warm-up of its own slot.
 *
 * Env: GREEKOS_LLM_MODEL (gguf path), LOCAL_LLM_PORT (3313), LOCAL_LLM_THREADS (cores − 1 on CPU),
 * LOCAL_LLM_CTX (4096 per slot), LOCAL_LLM_SLOTS (4), LOCAL_LLM_FLASH_ATTENTION (1 = on),
 * LOCAL_LLM_NO_REUSE (1 = evaluate every request from a clean sequence, for diagnosis).
 */
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { getLlama, LlamaChat } from 'node-llama-cpp';

const PORT = Number(process.env.LOCAL_LLM_PORT ?? 3313);
const MODEL = process.env.GREEKOS_LLM_MODEL ?? path.join(process.env.GREEKOS_MODELS ?? path.join(os.homedir(), 'greekos-models'), 'llm/gemma-4-E2B-it-Q4_K_M.gguf');
const CTX = Number(process.env.LOCAL_LLM_CTX ?? 4096);
const SLOTS = Math.max(1, Number(process.env.LOCAL_LLM_SLOTS ?? 4));
const NAME = path.basename(MODEL).replace(/\.gguf$/i, '');

const llama = await getLlama();
const model = await llama.loadModel({ modelPath: MODEL });
// CPU: all cores but one. Measured on 4 cores: prefill scales with threads (705 prompt tokens in 5.5 s
// with 4, 10.5 s with 2), generation does not (≈ 22 characters/s with 3 or 4 — memory-bound), and the
// spare core keeps speech synthesis of the reply running while the model writes. Prefill mostly happens
// ahead of time (warm-up). On Apple Silicon the GPU (Metal) does the work and threads only drive it.
const THREADS = Number(process.env.LOCAL_LLM_THREADS || Math.max(2, os.cpus().length - 1));
const ARCH = String(model.fileInfo?.metadata?.general?.architecture ?? '');
// Gemma 3/4 use sliding-window attention: a full-size SWA cache keeps every position, so a cached
// prefix stays valid when the tail of a conversation changes.
const SWA_FULL = process.env.LOCAL_LLM_SWA_FULL !== '0';
const FLASH = process.env.LOCAL_LLM_FLASH_ATTENTION === '1';
const context = await model.createContext({ contextSize: CTX, threads: THREADS, sequences: SLOTS, swaFullCache: SWA_FULL, flashAttention: FLASH });
// History of this setting: v6.1 passed the previous turn's context window as `lastEvaluationContextWindow`.
// node-llama-cpp then keeps that *old* window whenever it overlaps the sequence by ≥ 50 %, so the model
// re-answered the previous turn (it "repeated its opening"). That was blamed on Gemma's cache and reuse
// was switched off. Without that option the library diffs the new prompt against the cached tokens and
// evaluates only the new tail; greedy output is identical to a clean sequence (measured).
const NO_REUSE = process.env.LOCAL_LLM_NO_REUSE === '1';
const slots = Array.from({ length: SLOTS }, () => { const seq = context.getSequence(); return { key: null, seq, chat: new LlamaChat({ contextSequence: seq }), used: 0, queue: Promise.resolve(), running: null, pending: 0 }; });
function slotFor(key) {
  let slot = key ? slots.find((x) => x.key === key) : null;
  if (!slot) {
    // Least recently used among idle slots (a busy slot is never taken over).
    const idle = slots.filter((x) => !x.running && x.pending === 0);
    slot = (idle.length ? idle : slots).reduce((a, b) => (a.used <= b.used ? a : b));
    if (slot.key !== key) slot.reset = true;
    slot.key = key ?? null;
  }
  slot.used = Date.now();
  return slot;
}
const grammars = new Map();
const BACKGROUND = new Set(['speaking_prefill', 'speaking_feedback']);

function toHistory(messages) {
  const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const out = sys ? [{ type: 'system', text: sys }] : [];
  for (const m of messages) {
    if (m.role === 'user') out.push({ type: 'user', text: String(m.content) });
    else if (m.role === 'assistant') out.push({ type: 'model', response: [String(m.content)] });
  }
  out.push({ type: 'model', response: [] });
  return out;
}

async function grammarFor(rf) {
  if (!rf || rf.type !== 'json_schema' || !rf.json_schema?.schema) return undefined;
  const key = JSON.stringify(rf.json_schema.schema);
  if (!grammars.has(key)) grammars.set(key, await llama.createGrammarForJsonSchema(rf.json_schema.schema));
  return grammars.get(key);
}

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

async function complete(slot, job) {
  const { res, body, queuedAt, op } = job;
  // A caller that timed out while queued must not cost a full generation later.
  if (res.destroyed || res.writableEnded || !res.socket || res.socket.destroyed) { console.log(`skip aborted request queued ${Date.now() - queuedAt} ms`); return; }
  const started = Date.now();
  if (process.env.LOCAL_LLM_DUMP) (await import('node:fs')).writeFileSync(path.join(process.env.LOCAL_LLM_DUMP, `req-${started}.json`), JSON.stringify(body));
  const grammar = await grammarFor(body.response_format);
  const history = toHistory(body.messages ?? []);
  let firstTokenMs = null;
  const stream = !!body.stream;
  if (stream) res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  const ac = new AbortController();
  job.ac = ac;
  // IncomingMessage 'close' fires once the body is consumed; the response's 'close' means the client left.
  res.on('close', () => { if (!res.writableEnded) ac.abort(); });
  const id = `chatcmpl-${Date.now().toString(36)}`;
  if (NO_REUSE || slot.reset) { await slot.seq.clearHistory(); slot.reset = false; }
  // How much of this prompt the slot already holds (for the log and the caller's timing).
  const promptTokens = slot.chat.chatWrapper.generateContextState({ chatHistory: history }).contextText.tokenize(model.tokenizer);
  const reusedTokens = Math.min(slot.seq.compareContextTokens(promptTokens).firstDifferentIndex, slot.seq.nextTokenIndex);
  let result;
  try {
    result = await slot.chat.generateResponse(history, {
      grammar,
      maxTokens: Math.min(Number(body.max_tokens ?? 512), 2048),
      temperature: Number(body.temperature ?? 0.6),
      signal: ac.signal,
      stopOnAbortSignal: true,
      evaluationPriority: BACKGROUND.has(op) ? 3 : 8,
      onTextChunk: (chunk) => {
        if (firstTokenMs === null) firstTokenMs = Date.now() - started;
        if (stream && !res.writableEnded) res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model: NAME, choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }] })}\n\n`);
      },
    });
  } catch (e) {
    // A pre-empted warm-up: the tokens it evaluated stay in the slot; nothing to report.
    if (ac.signal.aborted) { if (!res.writableEnded) res.end(); console.log(`aborted ${op ?? 'request'} slot ${slots.indexOf(slot)} after ${Date.now() - started} ms`); return; }
    throw e;
  }
  const text = result.response;
  const finish = result.metadata?.stopReason === 'maxTokens' ? 'length' : 'stop';
  const timing = { total_ms: Date.now() - started, first_token_ms: firstTokenMs, queued_ms: started - queuedAt, prompt_tokens: promptTokens.length, reused_tokens: reusedTokens };
  console.log(`completion ${JSON.stringify({ op: op ?? null, ...timing, slot: slots.indexOf(slot), out_chars: text.length, finish: result.metadata?.stopReason ?? null, aborted: ac.signal.aborted })}`);
  if (res.writableEnded) return;
  if (stream) {
    res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model: NAME, choices: [{ index: 0, delta: {}, finish_reason: finish }], usage: { prompt_tokens: promptTokens.length, completion_tokens: model.tokenize(text).length }, greekos_timing: timing })}\n\n`);
    res.end('data: [DONE]\n\n');
  } else {
    send(res, 200, { id, object: 'chat.completion', model: NAME, choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: finish }], usage: { prompt_tokens: promptTokens.length, completion_tokens: model.tokenize(text).length }, greekos_timing: timing });
  }
}

function enqueue(job) {
  const key = typeof job.body.user === 'string' ? job.body.user : null;
  const slot = slotFor(key);
  // The learner is waiting: a warm-up of the same conversation stops; what it evaluated is kept.
  if (!BACKGROUND.has(job.op) && slot.running && slot.running.op === 'speaking_prefill') slot.running.ac?.abort();
  slot.pending += 1;
  slot.queue = slot.queue.then(async () => {
    slot.pending -= 1;
    slot.running = job;
    try { await complete(slot, job); } finally { slot.running = null; }
  }).catch((e) => {
    const { res } = job;
    console.error('[local-llm]', e?.message ?? e);
    if (!res.headersSent) send(res, 500, { error: { message: String(e?.message ?? e).slice(0, 300) } }); else if (!res.writableEnded) res.end();
  });
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, model: NAME, context: CTX, gpu: llama.gpu || 'cpu', threads: THREADS, slots: SLOTS, kv_reuse: !NO_REUSE, swa_full_cache: SWA_FULL, flash_attention: FLASH, arch: ARCH, busy_slots: slots.filter((x) => x.running).length });
  if (req.method === 'GET' && url.pathname === '/v1/models') return send(res, 200, { object: 'list', data: [{ id: NAME, object: 'model', owned_by: 'local' }] });
  if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 2_000_000) req.destroy(); });
    req.on('end', () => {
      let body;
      try { body = JSON.parse(raw); } catch { return send(res, 400, { error: { message: 'bad json' } }); }
      enqueue({ req, res, body, queuedAt: Date.now(), op: String(req.headers['x-greekos-operation'] ?? '') || null });
    });
    return;
  }
  send(res, 404, { error: { message: 'not found' } });
}).listen(PORT, '127.0.0.1', () => console.log(`greekos-local-llm on 127.0.0.1:${PORT} model=${NAME} arch=${ARCH} gpu=${llama.gpu || 'cpu'} kv_reuse=${!NO_REUSE}`));
