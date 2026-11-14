// GreekOS ops — reproduce the production conversation-turn request against the real Anthropic API
// and print the exact provider answer. Two requests that differ ONLY in the schema:
//   A) the turn schema exactly as src/lib/speaking/conversation.ts built it (facts: maxItems 2)
//   B) the same schema without maxItems
// Cost: A is rejected before generation (no charge) if the schema is the cause; B is one short turn
// of the dialogue model (≈ 0.0005 USD). Never prints the key.
import Anthropic from '@anthropic-ai/sdk';
import { betaJSONSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/beta/json-schema';

const model = process.env.LLM_MODEL_DIALOGUE || 'claude-haiku-5-5';
const key = process.env.ANTHROPIC_API_KEY;
if (!key) { console.error('ANTHROPIC_API_KEY missing'); process.exit(2); }
const client = new Anthropic({ apiKey: key, maxRetries: 0 });
const INTENTS = ['on_task', 'clarification_request', 'code_switch', 'off_task', 'unintelligible', 'goal_achieved'];

function schema(withMaxItems) {
  const facts = { type: 'array', items: { type: 'string' } };
  if (withMaxItems) facts.maxItems = 2;
  const props = {
    stage: { type: 'string', enum: ['N2', 'N1', 'REPAIR'] },
    reply_el: { type: 'string' },
    intent: { type: 'string', enum: INTENTS },
    hint_ru: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    facts,
  };
  return { type: 'object', properties: props, required: Object.keys(props), additionalProperties: false };
}

const system = 'Ты — продавец в супермаркете в Салониках. Ученик — русскоязычный, уровень A1. Отвечай в reply_el только на новогреческом, 1–2 коротких предложения, реагируй на слова ученика.';
const messages = [
  { role: 'user', content: '(Начало разговора. Начни.)' },
  { role: 'assistant', content: 'Γεια σας! Τι θα θέλατε;' },
  { role: 'user', content: 'Сейчас этап N1. Выбери stage: N2 — ученик назвал товар. Слова ученика: «Θέλω δύο μπουκάλι νερό.»' },
];

async function run(label, withMaxItems, opts = {}) {
  const started = Date.now();
  let first = null; let text = ''; let usage = {}; let stop = null; let served = model;
  try {
    const stream = await client.beta.messages.create({
      model, max_tokens: 4096, stream: true, cache_control: { type: 'ephemeral' }, system, messages,
      ...(opts.thinking ? { thinking: opts.thinking } : {}),
      output_config: { format: { type: 'json_schema', schema: opts.transform ? betaJSONSchemaOutputFormat(schema(withMaxItems)).schema : schema(withMaxItems) }, effort: 'low' },
    }, { timeout: 25_000 });
    for await (const ev of stream) {
      if (ev.type === 'message_start') { served = ev.message.model; usage = { ...ev.message.usage }; }
      else if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') { first ??= Date.now() - started; text += ev.delta.text; }
      else if (ev.type === 'message_delta') { stop = ev.delta.stop_reason; usage.output_tokens = ev.usage?.output_tokens; }
    }
    const inTok = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
    const usd = inTok * 0.10 / 1e6 + (usage.output_tokens ?? 0) * 0.50 / 1e6;
    console.log(JSON.stringify({ case: label, ok: true, model: served, stop, first_token_ms: first, total_ms: Date.now() - started, input_tokens: inTok, output_tokens: usage.output_tokens, est_usd: Number(usd.toFixed(6)), reply: text }, null, 1));
  } catch (e) {
    console.log(JSON.stringify({ case: label, ok: false, http_status: e?.status ?? null, error_type: e?.error?.error?.type ?? e?.name, message: e?.error?.error?.message ?? e?.message, request_id: e?.requestID ?? e?.request_id ?? null, total_ms: Date.now() - started }, null, 1));
  }
}

const which = (process.env.LLM_DIAG_CASES || 'A,B').split(',');
if (which.includes('A')) await run('A_production_schema_maxItems_2', true);
if (which.includes('B')) await run('B_same_schema_without_maxItems', false);
// The fix: the SDK's own transform moves unsupported constraints into the description.
if (which.includes('C')) await run('C_sdk_transformed_schema_adaptive_thinking', true, { transform: true });
if (which.includes('D')) await run('D_sdk_transformed_schema_thinking_disabled', true, { transform: true, thinking: { type: 'disabled' } });
if (which.includes('E')) await run('E_repeat_D_for_latency', true, { transform: true, thinking: { type: 'disabled' } });
