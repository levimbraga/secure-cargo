import { cn } from "cn";

type Verdict = "pass" | "fail" | "warn" | "neutral";

const styles: Record<Verdict, string> = {
  pass: "bg-pass-tint text-pass",
  fail: "bg-fail-tint text-fail",
  warn: "bg-warn-tint text-warn",
  neutral: "bg-surface text-gray",
};

function Icon({ verdict }: { verdict: Verdict }) {
  const common = {
    width: 12,
    height: 12,
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
  if (verdict === "warn") {
    return (
      <svg {...common}>
        <path d="M7 3v5M7 10.8v.2" />
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
        "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[0.8125rem] font-medium",
        styles[verdict],
        className,
      )}
    >
      <Icon verdict={verdict} />
      {children}
    </span>
  );
}
