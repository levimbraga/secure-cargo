/** One line of data: gray label on the left, mono value on the right, hairline above. */
export function DataRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-6 border-t border-hairline py-2.5">
      <dt className="text-gray">{label}</dt>
      <dd className="text-right font-mono text-[0.9375rem] text-ink">{children}</dd>
    </div>
  );
}
