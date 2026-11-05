import { describe, expect, it } from 'vitest';
import { examPlayDecision, EXAM_LISTENING_PLAYS } from '@/lib/exams/core';

describe('exam listening play limit (A06)', () => {
  it('simulation allows exactly the form limit per recording', () => {
    expect(EXAM_LISTENING_PLAYS).toBe(2);
    expect(examPlayDecision('simulation', {}, 'a')).toEqual({ allowed: true, used: 0, remaining: 2 });
    expect(examPlayDecision('simulation', { a: 1 }, 'a')).toEqual({ allowed: true, used: 1, remaining: 1 });
    expect(examPlayDecision('simulation', { a: 2 }, 'a')).toEqual({ allowed: false, used: 2, remaining: 0 });
    expect(examPlayDecision('simulation', { a: 2 }, 'b').allowed).toBe(true);
  });
  it('practice is not limited; malformed counters cannot go negative', () => {
    expect(examPlayDecision('practice', { a: 9 }, 'a')).toEqual({ allowed: true, used: 9, remaining: null });
    expect(examPlayDecision('simulation', { a: -3 }, 'a').used).toBe(0);
  });
});
