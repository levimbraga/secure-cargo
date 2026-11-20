import { cn } from "cn";

type Verdict = "pass" | "fail" | "neutral";

const styles: Record<Verdict, string> = {
  pass: "bg-pass-tint text-pass",
  fail: "bg-fail-tint text-fail",
  neutral: "bg-surface text-muted-foreground",
};

function Icon({ verdict }: { verdict: Verdict }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: "0 0 14 14",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (verdict === "pass") {
    return (
      <svg {...common}>
        <path d="M2.5 7.5 5.5 10.5 11.5 3.5" />
      </svg>
    );
  }
  if (verdict === "fail") {
    return (
      <svg {...common}>
        <path d="M3 3l8 8M11 3l-8 8" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="7" cy="7" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** A result: icon + word + color. Status colors are used for verdicts only. */
export function VerdictBadge({
  verdict,
  children,
  className,
}: {
  verdict: Verdict;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "type-small inline-flex h-7 items-center gap-1.5 rounded-full px-3 font-medium",
        styles[verdict],
        className,
      )}
    >
      <Icon verdict={verdict} />
      {children}
    </span>
  );
}
