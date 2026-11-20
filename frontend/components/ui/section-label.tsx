/** Small mono label above a section heading. Use once per section. */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="type-label">{children}</p>;
}
