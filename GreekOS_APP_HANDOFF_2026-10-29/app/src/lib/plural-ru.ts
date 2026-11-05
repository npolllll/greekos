/** Russian noun form for a count: 1 задание, 2 задания, 5 заданий, 11 заданий, 21 задание. */
export function pluralRu(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(Math.trunc(n)) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

/** «44 сценария», «1 задание». */
export function countRu(n: number, one: string, few: string, many: string): string {
  return `${n} ${pluralRu(n, one, few, many)}`;
}

/** Singular verb agreement with a count («1 задание требует», «2 задания требуют»). */
export function singularVerbRu(n: number): boolean {
  const a = Math.abs(Math.trunc(n)) % 100;
  return a % 10 === 1 && a !== 11;
}
