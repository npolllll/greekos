/** GreekOS emblem: an original four-armed meander (Greek key) knot drawn on a 24 px grid. */
export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="square" strokeLinejoin="miter">
      <path d="M9 2h6v4h-3v3h3v2H9V7h3V5H9z" />
      <path d="M22 9v6h-4v-3h-3v3h-2V9h4v3h2V9z" />
      <path d="M15 22H9v-4h3v-3H9v-2h6v4h-3v2h3z" />
      <path d="M2 15V9h4v3h3V9h2v6H7v-3H5v3z" />
    </svg>
  );
}
