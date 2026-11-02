import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CORPUS } from '../corpus';
import { adapterFor, choiceOptions, type ItemEnvelope } from '@/lib/content/types';
import { buildItemDTO, assertNoLeak } from '@/lib/content/dto';
import { scoreDeterministic, keyedOptions } from '@/lib/scoring/score';

/**
 * Every one of the 1 843 corpus items, through the learner path: the type has a player, the learner
 * DTO builds without leaking the key, the item's own key is accepted (or goes to review when the
 * item is review-only by design) and a clearly wrong answer is never marked correct.
 */
const items: ItemEnvelope[] = JSON.parse(readFileSync(resolve(CORPUS, 'HANDOFF_IMPORT/items.json'), 'utf8'));
const str = (v: unknown) => (typeof v === 'string' ? v : null);

type Outcome = { id: string; type: string; problem: string };

function check(item: ItemEnvelope): Outcome | null {
  const kind = adapterFor(item.type, item.options);
  if (!kind) return { id: item.item_id, type: item.type, problem: 'NO_PLAYER' };
  let dto;
  try {
    dto = buildItemDTO({ item, contentHash: 'h', audio: { status: 'unavailable', reason: 'TEST' } as never });
    assertNoLeak(dto);
  } catch (e) {
    return { id: item.item_id, type: item.type, problem: `DTO:${(e as Error).message.slice(0, 80)}` };
  }
  if (item.scoring.strategy === 'JOINT_BANK_REVIEW') return null;
  if (kind === 'open_text') {
    // A keyed item with an automatic strategy must not end in «на проверке» for every answer.
    if (item.scoring.strategy !== 'REVIEW_REQUIRED') return { id: item.item_id, type: item.type, problem: `AUTO_STRATEGY_AS_OPEN_TEXT:${item.scoring.strategy}` };
    const r = scoreDeterministic(item, { text: 'Κάποια απάντηση.' });
    return r.verdict === 'PENDING_REVIEW' ? null : { id: item.item_id, type: item.type, problem: `OPEN_NOT_REVIEW:${r.verdict}` };
  }
  if (kind === 'choice') {
    if (dto.options.length < 2) return { id: item.item_id, type: item.type, problem: 'CHOICE_WITH_<2_OPTIONS' };
    const opts = choiceOptions(item.options);
    const keys = keyedOptions(item, opts);
    if (!keys || !keys.size) return { id: item.item_id, type: item.type, problem: 'CHOICE_KEY_NOT_IN_OPTIONS' };
    const right = scoreDeterministic(item, { choice: [...keys][0] });
    if (right.verdict !== 'CORRECT') return { id: item.item_id, type: item.type, problem: `OWN_KEY:${right.verdict}` };
    const wrong = opts.find((o) => !keys.has(o.key));
    if (wrong && scoreDeterministic(item, { choice: wrong.key }).verdict === 'CORRECT') return { id: item.item_id, type: item.type, problem: 'WRONG_ACCEPTED' };
    return null;
  }
  const key = (Array.isArray(item.answer) ? item.answer : []).map(str).find(Boolean);
  if (!key) return item.scoring.strategy === 'REVIEW_REQUIRED' ? null : { id: item.item_id, type: item.type, problem: 'NO_TEXT_KEY' };
  const right = scoreDeterministic(item, { text: key });
  const reviewOnly = item.scoring.strategy === 'REVIEW_REQUIRED';
  if (right.verdict !== 'CORRECT' && !(reviewOnly && right.verdict === 'PENDING_REVIEW')) return { id: item.item_id, type: item.type, problem: `OWN_KEY:${right.verdict}:${right.uncertainty ?? ''}` };
  const wrong = scoreDeterministic(item, { text: 'ζζζ ξξξ' });
  if (wrong.verdict === 'CORRECT') return { id: item.item_id, type: item.type, problem: 'WRONG_ACCEPTED' };
  return null;
}

describe('every corpus item works through the learner path', () => {
  it('has 1 843 items', () => expect(items.length).toBe(1843));

  it('no item type without a player, no leak, own key accepted, wrong answer rejected', () => {
    const problems = items.map(check).filter((x): x is Outcome => !!x);
    const byType = problems.reduce<Record<string, Record<string, number>>>((a, p) => {
      const k = p.problem.split(':').slice(0, 2).join(':');
      ((a[p.type] ??= {})[k] = (a[p.type][k] ?? 0) + 1);
      return a;
    }, {});
    expect(byType).toEqual({});
  });
});
