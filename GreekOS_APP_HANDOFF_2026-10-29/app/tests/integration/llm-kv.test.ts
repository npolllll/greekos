import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import './helpers';

/**
 * Regression (mandate §5): with KV-cache reuse the local model server once answered the previous turn —
 * it resumed from the old context window instead of the new history. Three requests in one cache slot
 * (same conversation key): each answer must follow the request's own last message, also when the
 * history diverges from what the slot holds.
 */
const BASE = (process.env.LLM_BASE_URL ?? 'http://127.0.0.1:3313').replace(/\/$/, '');
const up = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(3000) }).then((r) => r.ok).catch(() => false);
const SYSTEM = 'Повтори последнее греческое слово из последнего сообщения пользователя в поле word.';

async function ask(key: string, messages: Array<{ role: 'user' | 'assistant'; content: string }>): Promise<string> {
  const r = await fetch(`${BASE}/v1/chat/completions`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    // Structured output, as every request of the app is (the conversation key selects the cache slot).
    body: JSON.stringify({
      model: 'local', messages: [{ role: 'system', content: SYSTEM }, ...messages], max_tokens: 40, temperature: 0, user: key,
      response_format: { type: 'json_schema', json_schema: { name: 'w', schema: { type: 'object', properties: { word: { type: 'string' } }, required: ['word'], additionalProperties: false } } },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const j = (await r.json()) as { choices: Array<{ message: { content: string } }> };
  return (JSON.parse(j.choices[0].message.content) as { word: string }).word;
}

describe.skipIf(!up)('local model server: KV-cache reuse keeps the current context', () => {
  it('answers each request\'s own last message in one cache slot', async () => {
    const key = `kv-regression-${randomUUID()}`;
    const a = await ask(key, [{ role: 'user', content: 'Η λέξη είναι: μήλο' }]);
    expect(a).toMatch(/μήλο/i);
    // Same slot, history extended: the answer follows the new last message, not the previous one.
    const b = await ask(key, [{ role: 'user', content: 'Η λέξη είναι: μήλο' }, { role: 'assistant', content: JSON.stringify({ word: a }) }, { role: 'user', content: 'Η λέξη είναι: θάλασσα' }]);
    expect(b).toMatch(/θάλασσα/i);
    expect(b).not.toMatch(/μήλο/i);
    // Same slot, history diverging from what the slot holds.
    const c = await ask(key, [{ role: 'user', content: 'Η λέξη είναι: σπίτι' }]);
    expect(c).toMatch(/σπίτι/i);
  }, 300_000);
});
