/**
 * Calendar arithmetic on learner-local dates (ISO yyyy-mm-dd strings, no time component).
 * UTC timestamps are stored for events; the learner's IANA timezone determines the local day.
 */

export type LocalDate = string; // 'YYYY-MM-DD'

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Local calendar date of an instant in a given IANA timezone. */
export function localDateOf(instant: Date, timeZone: string): LocalDate {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function parse(d: LocalDate): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) throw new RangeError(`invalid local date ${d}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function fmt(y: number, m: number, d: number): LocalDate {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function addDays(d: LocalDate, days: number): LocalDate {
  const [y, m, dd] = parse(d);
  const t = new Date(Date.UTC(y, m - 1, dd + days));
  return fmt(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Add calendar months preserving day-of-month, clamping to the target month's last day. */
export function addMonthsClamped(d: LocalDate, months: number): LocalDate {
  const [y, m, dd] = parse(d);
  const total = y * 12 + (m - 1) + months;
  const ty = Math.floor(total / 12);
  const tm = (total % 12) + 1;
  return fmt(ty, tm, Math.min(dd, daysInMonth(ty, tm)));
}

/** Days from a to b (b - a) in calendar days. */
export function diffDays(a: LocalDate, b: LocalDate): number {
  const [ay, am, ad] = parse(a);
  const [by, bm, bd] = parse(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

export const PLAN_MONTHS = 9;

/** Base plan end: 9 calendar months from the learner's actual start. Exam date never re-anchors it. */
export function planEndDate(startDate: LocalDate): LocalDate {
  return addMonthsClamped(startDate, PLAN_MONTHS);
}

export function planProgress(startDate: LocalDate, today: LocalDate): { elapsedDays: number; totalDays: number; ratio: number } {
  const end = planEndDate(startDate);
  const totalDays = diffDays(startDate, end);
  const elapsedDays = Math.max(0, Math.min(totalDays, diffDays(startDate, today)));
  return { elapsedDays, totalDays, ratio: totalDays ? elapsedDays / totalDays : 0 };
}

/** Half-open UTC window [asOf - days, asOf) used for "last 14 days" error counting. */
export function inUtcWindow(eventIso: string, asOfIso: string, days: number): boolean {
  const t = Date.parse(eventIso);
  const asOf = Date.parse(asOfIso);
  return t >= asOf - days * 86_400_000 && t < asOf;
}

const RU_WEEKDAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
export function weekdayShortRu(d: LocalDate): string {
  const [y, m, dd] = parse(d);
  return RU_WEEKDAYS[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()];
}

export function formatLocalDateRu(d: LocalDate, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' }): string {
  const [y, m, dd] = parse(d);
  return new Intl.DateTimeFormat('ru-RU', { ...opts, timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, dd)));
}
