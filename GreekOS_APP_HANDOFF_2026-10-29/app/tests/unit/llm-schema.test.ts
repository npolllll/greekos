import { describe, expect, it } from 'vitest';
import { anthropicJsonSchema, thinkingOff } from '@/lib/providers/llm-stream';
import { turnSchema } from '@/lib/speaking/conversation';

// Keywords the Messages API rejects inside output_config.format.schema (HTTP 400 «… is not supported»).
// Production failed on exactly this: «For 'array' type, property 'maxItems' is not supported» (13.11.2026).
const UNSUPPORTED = ['maxItems', 'minLength', 'maxLength', 'pattern', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'];

function keysDeep(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.push(k); keysDeep(x, out); }
  return out;
}

describe('structured output schema sent to Anthropic', () => {
  it('the conversation turn schema has no keyword the API rejects', () => {
    for (const withHint of [true, false]) {
      const sent = anthropicJsonSchema(turnSchema(['N1', 'N2', 'REPAIR'], withHint));
      expect(keysDeep(sent).filter((k) => UNSUPPORTED.includes(k))).toEqual([]);
      expect(sent).toMatchObject({ type: 'object', additionalProperties: false });
      expect((sent.properties as Record<string, unknown>).facts).toMatchObject({ type: 'array', items: { type: 'string' } });
    }
  });

  it('moves unsupported constraints into the description instead of sending them', () => {
    const sent = anthropicJsonSchema({ type: 'object', properties: { tags: { type: 'array', items: { type: 'string' }, maxItems: 2 } }, required: ['tags'], additionalProperties: false });
    const tags = (sent.properties as Record<string, Record<string, unknown>>).tags;
    expect(tags.maxItems).toBeUndefined();
    expect(String(tags.description)).toContain('maxItems');
  });

  it('turns thinking off only where the model accepts it', () => {
    expect(thinkingOff('claude-haiku-5-5')).toEqual({ thinking: { type: 'disabled' } });
    expect(thinkingOff('claude-sonnet-5-5')).toEqual({ thinking: { type: 'between_tools' } });
    expect(thinkingOff('claude-opus-5-5')).toEqual({});
    expect(thinkingOff('claude-fable-5-2')).toEqual({});
  });
});

describe('restoring spaces around numbers in task text', async () => {
  const { restoreNumberSpacing } = await import('@/lib/qa/content-revisions');
  it('separates words from numbers in Russian and Greek', () => {
    expect(restoreNumberSpacing('День7: Напишите80–110слов')).toBe('День 7: Напишите 80–110 слов');
    expect(restoreNumberSpacing('στις20:00 και θέμα48')).toBe('στις 20:00 και θέμα 48');
  });
  it('keeps Greek ordinals, Latin codes and times intact', () => {
    for (const t of ['του 19ου αιώνα', 'της 28ης Οκτωβρίου', 'ο 1ος όροφος', 'D7 и D28', 'A1–B2', '18:00–19:30']) expect(restoreNumberSpacing(t)).toBe(t);
  });
});
