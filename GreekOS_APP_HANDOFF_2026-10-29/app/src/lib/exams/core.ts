/** Pure ΚΕΓ B2 exam helpers (no I/O): timing, answer sanitising, autosave rules, labels. */

export type ComponentKind = 'reading' | 'use_of_language' | 'listening' | 'writing' | 'speaking';

export const KIND_RU: Record<ComponentKind, string> = {
  reading: 'Чтение',
  use_of_language: 'Использование языка',
  listening: 'Аудирование',
  writing: 'Письмо',
  speaking: 'Говорение',
};

export const EXAM_DISCLAIMER_RU = 'Авторская тренировочная форма — не официальный экзамен ΚΕΓ, без калибровки и доказанной эквивалентности.';
export const RESULT_DISCLAIMER_RU = 'Предварительный некалиброванный результат, не официальный балл.';

/** Logical W01 is an alias of the canonical KEG-B2-P01 (ID is never renamed). */
export function displayComponentId(componentId: string, logicalId: string | null): string {
  return logicalId && logicalId !== componentId ? logicalId : componentId;
}

export function formNumber(formId: string): string {
  return formId.replace('KEG-B2-', '');
}

interface FormJson {
  duration?: unknown;
  minutes?: unknown;
  author_timing_minutes?: unknown;
  sections?: Array<{ minutes?: unknown }>;
}

const pos = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

/**
 * Declared time for a component: component column → form.duration → form.minutes →
 * author_timing_minutes → sum of section minutes. Unknown stays null (never zero).
 */
export function componentDurationMinutes(durationColumn: number | null, form: FormJson | null | undefined): { minutes: number | null; basis: string } {
  if (pos(durationColumn)) return { minutes: durationColumn as number, basis: 'component' };
  if (!form) return { minutes: null, basis: 'unknown' };
  if (pos(form.duration)) return { minutes: form.duration as number, basis: 'form.duration' };
  if (pos(form.minutes)) return { minutes: form.minutes as number, basis: 'form.minutes' };
  if (pos(form.author_timing_minutes)) return { minutes: form.author_timing_minutes as number, basis: 'author_timing_minutes' };
  const s = (form.sections ?? []).map((x) => pos(x.minutes)).filter((x): x is number => x !== null);
  if (s.length && s.length === (form.sections ?? []).length) return { minutes: s.reduce((a, b) => a + b, 0), basis: 'sections' };
  return { minutes: null, basis: 'unknown' };
}

export interface ExamAnswer { choice?: string; text?: string }
export type ExamAnswers = Record<string, ExamAnswer>;

const MAX_TEXT = 6000;

/** Keep only answers for items of this component, bounded sizes, no unknown fields. */
export function sanitizeAnswers(raw: unknown, allowedItemIds: Iterable<string>): ExamAnswers {
  const allowed = new Set(allowedItemIds);
  const out: ExamAnswers = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!allowed.has(id) || !v || typeof v !== 'object') continue;
    const a = v as Record<string, unknown>;
    const ans: ExamAnswer = {};
    if (typeof a.choice === 'string' && a.choice.length <= 40) ans.choice = a.choice;
    if (typeof a.text === 'string') ans.text = a.text.slice(0, MAX_TEXT);
    if (ans.choice !== undefined || (ans.text !== undefined && ans.text.length > 0)) out[id] = ans;
  }
  return out;
}

export const EXPIRY_GRACE_MS = 10_000;

export type AutosaveDecision = { ok: true } | { ok: false; code: 'SUBMITTED' | 'EXPIRED' | 'STALE' | 'ABANDONED' };

/** Autosave accepted only for an in-progress, non-expired attempt with a strictly increasing seq. */
export function autosaveDecision(a: { status: string; autosave_seq: number; server_expires_at: string | null }, seq: number, now = Date.now()): AutosaveDecision {
  if (a.status === 'SUBMITTED') return { ok: false, code: 'SUBMITTED' };
  if (a.status === 'ABANDONED') return { ok: false, code: 'ABANDONED' };
  if (a.status === 'EXPIRED' || isExpired(a.server_expires_at, now)) return { ok: false, code: 'EXPIRED' };
  if (!(seq > a.autosave_seq)) return { ok: false, code: 'STALE' };
  return { ok: true };
}

export function isExpired(expiresAt: string | null, now = Date.now(), graceMs = EXPIRY_GRACE_MS): boolean {
  return !!expiresAt && now > Date.parse(expiresAt) + graceMs;
}

export function remainingMs(expiresAt: string | null, now = Date.now()): number | null {
  if (!expiresAt) return null;
  return Math.max(0, Date.parse(expiresAt) - now);
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function componentKindOf(componentId: string): ComponentKind {
  const letter = componentId.split('-')[2]?.[0];
  return ({ R: 'reading', U: 'use_of_language', L: 'listening', P: 'writing', W: 'writing', S: 'speaking' } as Record<string, ComponentKind>)[letter ?? ''] ?? 'reading';
}

export const STATUS_RU: Record<string, string> = {
  IN_PROGRESS: 'в процессе',
  SUBMITTED: 'сдано',
  EXPIRED: 'время вышло',
  ABANDONED: 'прервано',
};

export const REASON_RU: Record<string, string> = {
  OK: 'Доступно',
  CONTENT_GATED: 'Задания проходят проверку',
  AUDIO_PENDING: 'Нет проверенного аудио — аудирование не проводится',
  SPEAKING: 'Говорение проходит в разделе «Разговоры»',
  NO_ITEMS: 'Нет заданий',
};

/** KEG B2 listening: each recording is heard twice in the simulation (candidate sheet: «δύο φορές»). */
export const EXAM_LISTENING_PLAYS = 2;

/** Pure play-limit decision; practice mode is unlimited, simulation is limited per asset. */
export function examPlayDecision(mode: 'simulation' | 'practice', plays: Record<string, number>, assetId: string, limit = EXAM_LISTENING_PLAYS): { allowed: boolean; used: number; remaining: number | null } {
  const used = Math.max(0, Math.floor(plays[assetId] ?? 0));
  if (mode === 'practice') return { allowed: true, used, remaining: null };
  return { allowed: used < limit, used, remaining: Math.max(0, limit - used) };
}
