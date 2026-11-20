import { useFormatter } from "next-intl";

/**
 * A number with its unit. Always mono with tabular figures, formatted for the current locale,
 * and never split from its unit across lines.
 */
export function Num({
  value,
  unit,
  maximumFractionDigits = 2,
  className,
}: {
  value: number;
  unit?: string;
  maximumFractionDigits?: number;
  className?: string;
}) {
  const format = useFormatter();
  const text = format.number(value, { maximumFractionDigits });

  return (
    <span className={`font-mono tabular-nums ${className ?? ""}`}>
      {unit ? `${text} ${unit}` : text}
    </span>
  );
}
