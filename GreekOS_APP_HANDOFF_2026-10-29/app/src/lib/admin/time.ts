/** Request-time clock helpers for server components (kept out of render bodies). */
export function nowMs(): number {
  return Date.now();
}

export function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export function isoMonthStart(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
}
