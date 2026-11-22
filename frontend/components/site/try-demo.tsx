"use client";

import { cn } from "cn";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { useMe } from "@/components/app/me-context";
import { pill, type PillVariants } from "@/components/ui/pill";
import { Link, useRouter } from "@/i18n/navigation";
import { DEMO_START, type DemoRole, demoErrorCode, startDemoSession } from "@/lib/demo-session";

/**
 * "Try the demo": one click starts the demo session (the Worker's cookie; an existing demo session
 * keeps its sandbox) and opens the role's first screen, the photo step of a new inspection for the
 * driver. While it starts, the pill says so; if it fails, the sign-in page opens with the reason
 * next to the demo buttons. Before the page is interactive it is a plain link to that page.
 */
export function TryDemo({
  role = "driver",
  label,
  className,
  variant,
}: {
  role?: DemoRole;
  label?: string;
  className?: string;
  variant?: PillVariants["variant"];
}) {
  const t = useTranslations("Nav");
  const { inProvider, enterDemo } = useMe();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function start(event: React.MouseEvent) {
    // New tab, or the like: let the link do what it does.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      // Inside /app the provider must learn about the session; elsewhere /app reads it on arrival.
      if (inProvider) await enterDemo(role);
      else await startDemoSession(role);
      router.push(DEMO_START[role]);
    } catch (cause) {
      router.push(`/app/sign-in?demo_error=${demoErrorCode(cause)}`);
      setBusy(false);
    }
  }

  return (
    <Link
      href="/app/sign-in"
      onClick={start}
      aria-disabled={busy || undefined}
      aria-busy={busy || undefined}
      className={pill({ variant, className: cn("gap-2", busy && "cursor-progress", className) })}
      data-testid={`try-demo-${role}`}
    >
      {busy && (
        <span aria-hidden className="inline-block size-3 animate-spin rounded-full border-[1.5px] border-current border-r-transparent" />
      )}
      {busy ? t("ctaLoading") : (label ?? t("cta"))}
    </Link>
  );
}
