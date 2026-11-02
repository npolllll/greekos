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
 * Conversation slots: each request's `user` field (the speaking session id) keeps its own sequence,
 * so the next turn of the same conversation evaluates only the new tokens (KV-cache reuse).
 *
 * Env: GREEKOS_LLM_MODEL (gguf path), LOCAL_LLM_PORT (3313), LOCAL_LLM_THREADS (half the cores on CPU),
 * LOCAL_LLM_CTX (4096 per slot), LOCAL_LLM_SLOTS (3).
 */
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { getLlama, LlamaChat } from 'node-llama-cpp';

const PORT = Number(process.env.LOCAL_LLM_PORT ?? 3313);
const MODEL = process.env.GREEKOS_LLM_MODEL ?? path.join(process.env.GREEKOS_MODELS ?? path.join(os.homedir(), 'greekos-models'), 'llm/gemma-4-E2B-it-Q4_K_M.gguf');
const CTX = Number(process.env.LOCAL_LLM_CTX ?? 4096);
const SLOTS = Math.max(1, Number(process.env.LOCAL_LLM_SLOTS ?? 3));
const NAME = path.basename(MODEL).replace(/\.gguf$/i, '');

const llama = await getLlama();
const model = await llama.loadModel({ modelPath: MODEL });
// llama.cpp slows down sharply when oversubscribed; the speech service (TTS + Whisper) shares the CPU,
// so by default the model takes half of the cores. On Apple Silicon the GPU (Metal) does the work.
const THREADS = Number(process.env.LOCAL_LLM_THREADS || Math.max(2, Math.floor(os.cpus().length / 2)));
const ARCH = String(model.fileInfo?.metadata?.general?.architecture ?? '');
// Measured (scripts/speaking-eval.ts): with Gemma 3/4 GGUFs, reusing a cached prefix and erasing the rest
// corrupted the context even with a full-size SWA cache — the model repeated its own opening and swapped
// roles. For these architectures every request is evaluated from a clean sequence (correct, slower on CPU;
// fast with Metal). LOCAL_LLM_NO_REUSE=0|1 overrides; other architectures keep prefix reuse.
const SWA_FULL = process.env.LOCAL_LLM_SWA_FULL !== '0';
const context = await model.createContext({ contextSize: CTX, threads: THREADS, sequences: SLOTS, swaFullCache: SWA_FULL });
// One sequence per live conversation (LRU): its evaluated tokens stay in the KV cache between turns.
const NO_REUSE = process.env.LOCAL_LLM_NO_REUSE ? process.env.LOCAL_LLM_NO_REUSE === '1' : /gemma/i.test(ARCH);
const slots = Array.from({ length: SLOTS }, () => { const seq = context.getSequence(); return { key: null, seq, chat: new LlamaChat({ contextSequence: seq }), last: null, used: 0 }; });
function slotFor(key) {
  let slot = key ? slots.find((x) => x.key === key) : null;
  if (!slot) {
    slot = slots.reduce((a, b) => (a.used <= b.used ? a : b));
    slot.key = key ?? null;
    slot.last = null;
  }
  slot.used = Date.now();
  return slot;
}
const grammars = new Map();
let busy = Promise.resolve();

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

async function complete(req, res, body, queuedAt) {
  // A caller that timed out while queued must not cost a full generation later.
  if (res.destroyed || res.writableEnded || !res.socket || res.socket.destroyed) { console.log(`skip aborted request queued ${Date.now() - queuedAt} ms`); return; }
  const started = Date.now();
  const grammar = await grammarFor(body.response_format);
  const history = toHistory(body.messages ?? []);
  let firstTokenMs = null;
  const stream = !!body.stream;
  if (stream) res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  const ac = new AbortController();
  // IncomingMessage 'close' fires once the body is consumed; the response's 'close' means the client left.
  res.on('close', () => { if (!res.writableEnded) ac.abort(); });
  const id = `chatcmpl-${Date.now().toString(36)}`;
  const slot = slotFor(typeof body.user === 'string' ? body.user : null);
  if (NO_REUSE) { await slot.seq.clearHistory(); slot.last = null; }
  const last = slot.last;
  const result = await slot.chat.generateResponse(history, {
    grammar,
    maxTokens: Math.min(Number(body.max_tokens ?? 512), 2048),
    temperature: Number(body.temperature ?? 0.6),
    signal: ac.signal,
    stopOnAbortSignal: true,
    lastEvaluationContextWindow: last ? { history: last.history, minimumOverlapPercentageToPreventContextShift: 0.5 } : undefined,
    onTextChunk: (chunk) => {
      if (firstTokenMs === null) firstTokenMs = Date.now() - started;
      if (stream) res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model: NAME, choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }] })}\n\n`);
    },
  });
  slot.last = result.lastEvaluation?.contextWindow ? { history: result.lastEvaluation.contextWindow } : null;
  const text = result.response;
  const finish = result.metadata?.stopReason === 'maxTokens' ? 'length' : 'stop';
  const timing = { total_ms: Date.now() - started, first_token_ms: firstTokenMs, queued_ms: started - queuedAt };
  console.log(`completion ${JSON.stringify({ ...timing, slot: slots.indexOf(slot), reused: !!last, prompt_chars: JSON.stringify(body.messages ?? []).length, out_chars: result.response.length, finish: result.metadata?.stopReason ?? null, aborted: ac.signal.aborted })}`);
  if (stream) {
    res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model: NAME, choices: [{ index: 0, delta: {}, finish_reason: finish }], greekos_timing: timing })}\n\n`);
    res.end('data: [DONE]\n\n');
  } else {
    send(res, 200, { id, object: 'chat.completion', model: NAME, choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: finish }], usage: { completion_tokens: model.tokenize(text).length }, greekos_timing: timing });
  }
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, model: NAME, context: CTX, gpu: llama.gpu || 'cpu', threads: THREADS, slots: SLOTS, kv_reuse: !NO_REUSE, swa_full_cache: SWA_FULL, arch: ARCH });
  if (req.method === 'GET' && url.pathname === '/v1/models') return send(res, 200, { object: 'list', data: [{ id: NAME, object: 'model', owned_by: 'local' }] });
  if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 2_000_000) req.destroy(); });
    req.on('end', () => {
      let body;
      try { body = JSON.parse(raw); } catch { return send(res, 400, { error: { message: 'bad json' } }); }
      // One sequence: requests are serialised (a speaking turn is one request at a time).
      const queuedAt = Date.now();
      busy = busy.then(() => complete(req, res, body, queuedAt)).catch((e) => { if (!res.headersSent) send(res, 500, { error: { message: String(e?.message ?? e).slice(0, 300) } }); else res.end(); });
    });
    return;
  }
  send(res, 404, { error: { message: 'not found' } });
}).listen(PORT, '127.0.0.1', () => console.log(`greekos-local-llm on 127.0.0.1:${PORT} model=${NAME} arch=${ARCH} gpu=${llama.gpu || 'cpu'} kv_reuse=${!NO_REUSE}`));
