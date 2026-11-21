"use client";

import { useClerk } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { type DemoRole, useMe } from "@/components/app/me-provider";
import { pill } from "@/components/ui/pill";
import { useRouter } from "@/i18n/navigation";

const HOME: Record<DemoRole, "/app" | "/app/org"> = { driver: "/app", insurer: "/app/org" };

/**
 * "Enter as demo driver / insurer": the Worker starts an anonymous demo session (a signed,
 * httpOnly cookie, 24 hours) in a sandbox of its own: no account, no password, nothing a visitor
 * could change for the next one. Switching between driver and insurer keeps the sandbox.
 */
export function DemoButtons() {
  const t = useTranslations("Auth");
  const clerk = useClerk();
  const { enterDemo } = useMe();
  const router = useRouter();
  const [busy, setBusy] = useState<DemoRole | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    router.prefetch(HOME.driver);
    router.prefetch(HOME.insurer);
  }, [router]);

  async function enter(role: DemoRole) {
    setBusy(role);
    setError(null);
    try {
      // One session at a time: leave a real account before entering the demo.
      if (clerk.isSignedIn) await clerk.signOut({ redirectUrl: undefined });
      await enterDemo(role);
      router.push(HOME[role]);
    } catch (cause) {
      const code = (cause as { code?: string }).code;
      setError(code === "rate_limited" || code === "demo_unavailable" ? t(`errors.${code}`) : t("errors.failed"));
      setBusy(null);
    }
  }

  const intent = (role: DemoRole) => ({ onClick: () => void enter(role) });

  return (
    <div aria-busy={busy !== null}>
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={busy !== null} {...intent("driver")} className={pill({ className: "h-11 px-4" })}>
          {busy === "driver" && <Spinner />}
          {busy === "driver" ? t("entering") : t("demoDriver")}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          {...intent("insurer")}
          className={pill({ variant: "secondary", className: "h-11 px-4" })}
        >
          {busy === "insurer" && <Spinner />}
          {busy === "insurer" ? t("entering") : t("demoInsurer")}
        </button>
      </div>
      {busy ? (
        <div role="status" aria-live="polite" className="mt-4">
          <p className="font-[450] text-ink">{t(`signingIn.${busy}`)}</p>
          <p className="type-small mt-1 text-gray">{t("signingInNote")}</p>
          <div className="mt-3 h-0.5 w-full max-w-sm overflow-hidden bg-surface" aria-hidden>
            <div className="h-full w-1/3 animate-[indeterminate_1.1s_ease-in-out_infinite] bg-ink" />
          </div>
        </div>
      ) : (
        <p className="type-small mt-3 text-gray">{t("demoNote")}</p>
      )}
      {error && (
        <p role="alert" className="type-small mt-3 text-fail">
          {error}
        </p>
      )}
    </div>
  );
}

function Spinner() {
  return <span aria-hidden className="mr-2 inline-block size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" />;
}
