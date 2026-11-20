/** The SecureCargo mark: a crate held down by two straps. Inherits the text color. */
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden focusable="false" className={className}>
      <path d="M3 8h18v12H3z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path
        d="M8.5 20V5.5M15.5 20V5.5M5.75 5.5h12.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}
