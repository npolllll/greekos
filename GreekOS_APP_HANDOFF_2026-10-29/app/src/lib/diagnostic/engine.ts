/**
 * Multi-axis entry diagnostic (GreekOS_Academic_Corpus/diagnostics/ENTRY_PROTOCOL.json).
 * Pure state machine: per axis start at A1, advance after an independent success, stop after
 * two failures, missing audio → NOT_OBSERVED (never zero). Results are provisional profiles,
 * not calibrated CEFR placement; axes are never averaged into one level.
 */
export const AXES = ['grammar', 'vocabulary', 'reading', 'listening', 'writing', 'spoken_interaction', 'spoken_production', 'pronunciation'] as const;
export type Axis = (typeof AXES)[number];
export const LEVELS = ['A1', 'A2', 'B1'] as const;

export type AxisStatus = 'IN_PROGRESS' | 'OBSERVED' | 'NOT_OBSERVED' | 'PENDING_REVIEW' | 'STOPPED' | 'NO_RELEASED_CONTENT';

export interface Observation { item_id: string; level: string; verdict: string; assisted: boolean }

export interface AxisState {
  axis: Axis;
  level_idx: number;
  failures: number;
  status: AxisStatus;
  observations: Observation[];
  not_observed_reason: string | null;
}

export interface DiagState { axes: AxisState[]; current: number }

export interface ProbeItem { item_id: string; axis: Axis; level: string; usable: boolean; requires_audio: boolean; audio_ready: boolean; acoustic: boolean; voice_required: boolean; voice_available: boolean }

export function axisOf(itemId: string): Axis | null {
  const m = /^D-(A1|A2|B1)-([A-Z_]+)-\d+$/.exec(itemId);
  if (!m) return null;
  const a = m[2].toLowerCase() as Axis;
  return (AXES as readonly string[]).includes(a) ? a : null;
}

export function levelOf(itemId: string): string | null {
  return /^D-(A1|A2|B1)-/.exec(itemId)?.[1] ?? null;
}

export function initialState(): DiagState {
  return { axes: AXES.map((axis) => ({ axis, level_idx: 0, failures: 0, status: 'IN_PROGRESS', observations: [], not_observed_reason: null })), current: 0 };
}

/** Probe to present for an axis at its level, or a terminal status when none can be given. */
export function probeFor(state: AxisState, items: ProbeItem[]): { item: ProbeItem } | { terminal: AxisStatus; reason: string | null } {
  if (state.status !== 'IN_PROGRESS') return { terminal: state.status, reason: state.not_observed_reason };
  if (state.level_idx >= LEVELS.length) return { terminal: 'OBSERVED', reason: null };
  const item = items.find((i) => i.axis === state.axis && i.level === LEVELS[state.level_idx]);
  if (!item) return { terminal: state.observations.length ? 'OBSERVED' : 'NOT_OBSERVED', reason: 'NO_PROBE' };
  if (!item.usable) return { terminal: state.observations.length ? 'OBSERVED' : 'NO_RELEASED_CONTENT', reason: 'CONTENT_GATED' };
  if (item.acoustic) return { terminal: 'NOT_OBSERVED', reason: 'ACOUSTIC_ASSESSMENT_NOT_AVAILABLE' };
  if (item.voice_required && !item.voice_available) return { terminal: 'NOT_OBSERVED', reason: 'ASR_NOT_CONFIGURED' };
  if (item.requires_audio && !item.audio_ready) return { terminal: 'NOT_OBSERVED', reason: 'AUDIO_MISSING' };
  return { item };
}

/** Advance the machine to the next axis/item that can actually be presented. */
export function nextProbe(state: DiagState, items: ProbeItem[]): { state: DiagState; item: ProbeItem | null } {
  const s: DiagState = structuredClone(state);
  for (let guard = 0; guard < AXES.length + 1 && s.current < s.axes.length; guard++) {
    const ax = s.axes[s.current];
    const p = probeFor(ax, items);
    if ('item' in p) return { state: s, item: p.item };
    ax.status = p.terminal;
    ax.not_observed_reason = p.terminal === 'NOT_OBSERVED' || p.terminal === 'NO_RELEASED_CONTENT' ? p.reason : ax.not_observed_reason;
    s.current += 1;
  }
  return { state: s, item: null };
}

export function recordOutcome(state: DiagState, obs: Observation): DiagState {
  const s: DiagState = structuredClone(state);
  const ax = s.axes[s.current];
  if (!ax) return s;
  ax.observations.push(obs);
  const pass = !obs.assisted && (obs.verdict === 'CORRECT' || obs.verdict === 'ACCEPTABLE_VARIANT');
  const fail = !obs.assisted && obs.verdict === 'INCORRECT_CONFIRMED';
  if (pass) {
    ax.level_idx += 1;
    if (ax.level_idx >= LEVELS.length) { ax.status = 'OBSERVED'; s.current += 1; }
  } else if (fail) {
    ax.failures += 1;
    // One item per level: a failure ends the climb on this axis; two failures always stop it.
    ax.status = 'OBSERVED';
    s.current += 1;
  } else {
    ax.status = 'PENDING_REVIEW';
    ax.not_observed_reason = obs.assisted ? 'ASSISTED' : 'UNCERTAIN_ASSESSMENT';
    s.current += 1;
  }
  return s;
}

export function skipAxis(state: DiagState): DiagState {
  const s: DiagState = structuredClone(state);
  const ax = s.axes[s.current];
  if (ax) { ax.status = ax.observations.length ? 'OBSERVED' : 'STOPPED'; ax.not_observed_reason = ax.observations.length ? null : 'LEARNER_STOPPED'; s.current += 1; }
  return s;
}

/** Highest level independently demonstrated on the axis, and the provisional learning start. */
export function axisResult(ax: AxisState): { demonstrated: string | null; candidate_start: string | null; confidence: 'low' } {
  const passed = ax.observations.filter((o) => !o.assisted && (o.verdict === 'CORRECT' || o.verdict === 'ACCEPTABLE_VARIANT')).map((o) => LEVELS.indexOf(o.level as (typeof LEVELS)[number]));
  const top = passed.length ? Math.max(...passed) : -1;
  if (ax.status !== 'OBSERVED') return { demonstrated: top >= 0 ? LEVELS[top] : null, candidate_start: null, confidence: 'low' };
  const start = top + 1 >= LEVELS.length ? 'B1+' : LEVELS[top + 1];
  return { demonstrated: top >= 0 ? LEVELS[top] : null, candidate_start: start, confidence: 'low' };
}

/**
 * Conservative entry point: the lowest provisional start among grammar, vocabulary and reading
 * (observed axes only). If A1 reading itself fails, start with the alphabet foundations.
 * Returns null when there is not enough evidence: the owner/learner then chooses manually.
 */
export function routeStart(axes: AxisState[]): { level: 'FOUNDATIONS' | 'A1' | 'A2' | 'B1' | 'B2' | null; basis: Axis[] } {
  const core: Axis[] = ['grammar', 'vocabulary', 'reading'];
  const observed = axes.filter((a) => core.includes(a.axis) && a.status === 'OBSERVED');
  if (!observed.length) return { level: null, basis: [] };
  const reading = axes.find((a) => a.axis === 'reading');
  if (reading?.status === 'OBSERVED' && axisResult(reading).demonstrated === null) return { level: 'FOUNDATIONS', basis: ['reading'] };
  const order = ['A1', 'A2', 'B1', 'B1+'];
  const starts = observed.map((a) => axisResult(a).candidate_start ?? 'A1');
  const min = starts.sort((x, y) => order.indexOf(x) - order.indexOf(y))[0];
  // The probes stop at B1: never place into B2 from three items; B1+ starts at B1 with earlier units skippable.
  return { level: min === 'B1+' ? 'B1' : (min as 'A1' | 'A2' | 'B1'), basis: observed.map((a) => a.axis) };
}
