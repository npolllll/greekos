#!/usr/bin/env node
/**
 * GreekOS local LLM server — development only, binds 127.0.0.1. OpenAI-compatible subset:
 *   GET  /health, GET /v1/models
 *   POST /v1/chat/completions  {messages, max_tokens, temperature, stream?, response_format?}
 *        response_format {type:"json_schema", json_schema:{schema}} → grammar-constrained JSON.
 * Engine: node-llama-cpp (llama.cpp) with a local GGUF model, CPU or Metal; no network, no keys.
 * The default model is Qwen3-4B-Instruct-2507 (Apache-2.0), obtained as an OCI artifact
 * (docker.io/ai/qwen3:4b-instruct-2507-q4_K_M). Quality for Greek dialogue is NOT validated here.
 *
 * Env: GREEKOS_LLM_MODEL (gguf path), LOCAL_LLM_PORT (3313), LOCAL_LLM_THREADS, LOCAL_LLM_CTX (4096).
 */
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { getLlama, LlamaChat } from 'node-llama-cpp';

const PORT = Number(process.env.LOCAL_LLM_PORT ?? 3313);
const MODEL = process.env.GREEKOS_LLM_MODEL ?? path.join(process.env.GREEKOS_MODELS ?? path.join(os.homedir(), 'greekos-models'), 'llm/Qwen3-4B-Instruct-2507-Q4_K_M.gguf');
const CTX = Number(process.env.LOCAL_LLM_CTX ?? 4096);
const NAME = path.basename(MODEL).replace(/\.gguf$/i, '');

const llama = await getLlama();
const model = await llama.loadModel({ modelPath: MODEL });
const context = await model.createContext({ contextSize: CTX, threads: process.env.LOCAL_LLM_THREADS ? Number(process.env.LOCAL_LLM_THREADS) : undefined });
const sequence = context.getSequence();
const chat = new LlamaChat({ contextSequence: sequence });
const grammars = new Map();
let busy = Promise.resolve();
let last = null; // previous evaluation window: lets llama.cpp reuse the shared prompt prefix

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

async function complete(req, res, body) {
  const started = Date.now();
  const grammar = await grammarFor(body.response_format);
  const history = toHistory(body.messages ?? []);
  let firstTokenMs = null;
  const stream = !!body.stream;
  if (stream) res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  const ac = new AbortController();
  req.on('close', () => { if (!res.writableEnded) ac.abort(); });
  const id = `chatcmpl-${Date.now().toString(36)}`;
  const result = await chat.generateResponse(history, {
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
  last = result.lastEvaluation?.contextWindow ? { history: result.lastEvaluation.contextWindow } : null;
  const text = result.response;
  const finish = result.metadata?.stopReason === 'maxTokens' ? 'length' : 'stop';
  const timing = { total_ms: Date.now() - started, first_token_ms: firstTokenMs };
  if (stream) {
    res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model: NAME, choices: [{ index: 0, delta: {}, finish_reason: finish }], greekos_timing: timing })}\n\n`);
    res.end('data: [DONE]\n\n');
  } else {
    send(res, 200, { id, object: 'chat.completion', model: NAME, choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: finish }], usage: { completion_tokens: model.tokenize(text).length }, greekos_timing: timing });
  }
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, model: NAME, context: CTX, gpu: llama.gpu || 'cpu' });
  if (req.method === 'GET' && url.pathname === '/v1/models') return send(res, 200, { object: 'list', data: [{ id: NAME, object: 'model', owned_by: 'local' }] });
  if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 2_000_000) req.destroy(); });
    req.on('end', () => {
      let body;
      try { body = JSON.parse(raw); } catch { return send(res, 400, { error: { message: 'bad json' } }); }
      // One sequence: requests are serialised (a speaking turn is one request at a time).
      busy = busy.then(() => complete(req, res, body)).catch((e) => { if (!res.headersSent) send(res, 500, { error: { message: String(e?.message ?? e).slice(0, 300) } }); else res.end(); });
    });
    return;
  }
  send(res, 404, { error: { message: 'not found' } });
}).listen(PORT, '127.0.0.1', () => console.log(`greekos-local-llm on 127.0.0.1:${PORT} model=${NAME} gpu=${llama.gpu || 'cpu'}`));
