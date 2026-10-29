/**
 * Deterministic adaptive planning (ADAPTIVE_ENGINE_CONTRACT v0.1.2). Pure functions; the
 * server loader feeds released content and the learner's own evidence. No randomness, no LLM.
 */

export interface Budget {
  correction: number;
  retention: number;
  new_content: number;
  independent_application: number;
  weak_correction: number;
  strong_correction: number;
}

const SHARES: Array<[keyof Budget, number]> = [
  ['correction', 0.3],
  ['retention', 0.2],
  ['new_content', 0.3],
  ['independent_application', 0.2],
];

/** Largest-remainder rounding; ties resolved by the listed order. */
export function largestRemainder(total: number, shares: Array<[string, number]>): Record<string, number> {
  const raw = shares.map(([k, s], i) => ({ k, i, exact: total * s, floor: Math.floor(total * s + 1e-9) }));
  let left = total - raw.reduce((a, r) => a + r.floor, 0);
  const order = [...raw].sort((a, b) => (b.exact - b.floor) - (a.exact - a.floor) || a.i - b.i);
  const out: Record<string, number> = Object.fromEntries(raw.map((r) => [r.k, r.floor]));
  for (const r of order) {
    if (left <= 0) break;
    out[r.k] += 1;
    left -= 1;
  }
  return out;
}

export function splitBudget(minutes: number): Budget {
  const m = Math.max(0, Math.floor(minutes));
  const b = largestRemainder(m, SHARES) as Record<string, number>;
  const c = largestRemainder(b.correction, [['weak', 0.8], ['strong', 0.2]]);
  return {
    correction: b.correction, retention: b.retention, new_content: b.new_content,
    independent_application: b.independent_application, weak_correction: c.weak, strong_correction: c.strong,
  };
}

export interface Availability {
  weak: boolean;
  strong: boolean;
  retention: boolean;
  new_content: boolean;
  independent_application: boolean;
}

export type FallbackLog = Array<{ from: string; to: string; minutes: number }>;

/**
 * Move minutes out of empty buckets: weak<->strong first, then correction to retention,
 * new_content, application. If nothing is eligible: NO_ELIGIBLE_CONTENT (never invent tasks).
 */
export function redistribute(budget: Budget, a: Availability): { budget: Budget; log: FallbackLog; status: 'OK' | 'NO_ELIGIBLE_CONTENT' } {
  const b = { ...budget };
  const log: FallbackLog = [];
  if (!a.weak && !a.strong && !a.retention && !a.new_content && !a.independent_application) {
    return { budget: { correction: 0, retention: 0, new_content: 0, independent_application: 0, weak_correction: 0, strong_correction: 0 }, log, status: 'NO_ELIGIBLE_CONTENT' };
  }
  if (!a.weak && a.strong && b.weak_correction) { log.push({ from: 'weak_correction', to: 'strong_correction', minutes: b.weak_correction }); b.strong_correction += b.weak_correction; b.weak_correction = 0; }
  if (!a.strong && a.weak && b.strong_correction) { log.push({ from: 'strong_correction', to: 'weak_correction', minutes: b.strong_correction }); b.weak_correction += b.strong_correction; b.strong_correction = 0; }
  const chain: Array<keyof Budget> = ['correction', 'retention', 'new_content', 'independent_application'];
  const avail: Record<string, boolean> = { correction: a.weak || a.strong, retention: a.retention, new_content: a.new_content, independent_application: a.independent_application };
  for (let i = 0; i < chain.length; i++) {
    const from = chain[i];
    if (avail[from] || !b[from]) continue;
    const to = [...chain.slice(i + 1), ...chain.slice(0, i)].find((k) => avail[k]);
    if (!to) continue;
    log.push({ from, to, minutes: b[from] });
    b[to] += b[from];
    b[from] = 0;
    if (from === 'correction') { b.weak_correction = 0; b.strong_correction = 0; }
    if (to === 'correction') { const c = largestRemainder(b.correction, [['weak', 0.8], ['strong', 0.2]]); b.weak_correction = c.weak; b.strong_correction = c.strong; }
  }
  return { budget: b, log, status: 'OK' };
}

/** Canonical node.prerequisites is reverse adjacency; outdegree = number of direct dependents. */
export function prerequisiteOutdegree(nodePrereqs: Record<string, string[]>): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(Object.keys(nodePrereqs).map((k) => [k, 0]));
  for (const [node, prereqs] of Object.entries(nodePrereqs)) {
    for (const p of new Set(prereqs)) if (p in out && p !== node) out[p] += 1;
  }
  return out;
}

export interface WeakCandidate {
  competency_id: string;
  reliable_errors_14d: number;
  outdegree: number;
  overdue_days: number;
  relevance: number;
}

export function rankWeak(c: WeakCandidate[]): WeakCandidate[] {
  return [...c].sort((a, b) =>
    b.reliable_errors_14d - a.reliable_errors_14d ||
    b.outdegree - a.outdegree ||
    b.overdue_days - a.overdue_days ||
    b.relevance - a.relevance ||
    a.competency_id.localeCompare(b.competency_id));
}

export interface ItemCandidate {
  item_id: string;
  last_seen_at: string | null;
}

/** never_seen first, then oldest last_seen, then item_id ascending (stable). */
export function orderItems<T extends ItemCandidate>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (!a.last_seen_at && b.last_seen_at) return -1;
    if (a.last_seen_at && !b.last_seen_at) return 1;
    if (a.last_seen_at && b.last_seen_at && a.last_seen_at !== b.last_seen_at) return a.last_seen_at.localeCompare(b.last_seen_at);
    return a.item_id.localeCompare(b.item_id);
  });
}

/** In each block of 5 corrective slots choose 4 weak and 1 strong (fallback logged by caller). */
export function correctiveSlotKind(slotIndex: number, hasWeak: boolean, hasStrong: boolean): 'weak' | 'strong' | null {
  const preferred = slotIndex % 5 === 4 ? 'strong' : 'weak';
  if (preferred === 'weak') return hasWeak ? 'weak' : hasStrong ? 'strong' : null;
  return hasStrong ? 'strong' : hasWeak ? 'weak' : null;
}

export interface EligibilityInput {
  released: boolean;
  requiresAudio: boolean;
  audioVerified: boolean;
  pool: string | null;
  mode: 'tutoring' | 'diagnostic' | 'exam' | 'review';
  usedInSession: boolean;
  prerequisitesKnownUnmet: boolean;
}

export type EligibilityResult = { eligible: true } | { eligible: false; reason: string };

export function itemEligibility(i: EligibilityInput): EligibilityResult {
  if (!i.released) return { eligible: false, reason: 'NOT_RELEASED' };
  if (i.requiresAudio && !i.audioVerified) return { eligible: false, reason: 'AUDIO_UNAVAILABLE' };
  const holdout = i.pool === 'exam_holdout' || i.pool === 'diagnostic_holdout';
  if (holdout && i.mode === 'tutoring') return { eligible: false, reason: 'HOLDOUT_EXCLUDED' };
  if (i.pool === 'diagnostic_holdout' && i.mode !== 'diagnostic') return { eligible: false, reason: 'HOLDOUT_EXCLUDED' };
  if (i.usedInSession) return { eligible: false, reason: 'ALREADY_USED_IN_SESSION' };
  if (i.prerequisitesKnownUnmet) return { eligible: false, reason: 'PREREQUISITE_PROBE_REQUIRED' };
  return { eligible: true };
}

/** Publication rule (FINALIZATION_ACCEPTANCE_FIXTURES PUB-01..04). */
export function publicationAllowed(i: { content_review: boolean; audio_required: boolean; audio_verified: boolean }): boolean {
  return i.content_review && (!i.audio_required || i.audio_verified);
}

/** Unknown effort is never zero: unknown → null (TIME-01). */
export function knownMinutes(estimate: number | null | undefined): number | null {
  return typeof estimate === 'number' && Number.isFinite(estimate) && estimate > 0 ? estimate : null;
}
