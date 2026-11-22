/** Outline of the SecureCargo mark: a taut strap folding over the corner of a load. */
export const MARK_PATH =
  "M150 805H360Q392 805 402 776L548 318Q568 252 600 238Q622 230 634 256L700 400Q710 420 732 420H858Q882 418 871 399L751 219Q737 203 710 202L496 191Q418 190 374 266L119 760Q105 805 150 805Z";

/** The square box around the mark, in the path's own units. */
export const MARK_VIEWBOX = { x: 100, y: 110, size: 790 };

/** The SecureCargo mark. Inherits the text color. */
export function Mark({ className }: { className?: string }) {
  const { x, y, size } = MARK_VIEWBOX;
  return (
    <svg viewBox={`${x} ${y} ${size} ${size}`} aria-hidden focusable="false" className={className}>
      <path d={MARK_PATH} fill="currentColor" />
    </svg>
  );
}
