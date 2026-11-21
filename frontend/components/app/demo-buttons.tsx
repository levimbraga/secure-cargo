"use client";

import { useClerk, useSignIn } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { pill } from "@/components/ui/pill";
import { useRouter } from "@/i18n/navigation";
import { API_URL } from "@/lib/api";
import { readError } from "@/lib/app-api";

type DemoRole = "driver" | "insurer";

const HOME: Record<DemoRole, "/app" | "/app/org"> = { driver: "/app", insurer: "/app/org" };

async function fetchTicket(role: DemoRole): Promise<string> {
  const response = await fetch(`${API_URL}/demo/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ as: role }),
  });
  if (!response.ok) throw await readError(response);
  return ((await response.json()) as { ticket: string }).ticket;
}

/** Tickets asked for ahead of the click, one per role (each signs in once). */
const early = new Map<DemoRole, Promise<string>>();

/** Start fetching a ticket early (hover, touch, focus); a failed attempt is forgotten. */
function warm(role: DemoRole): Promise<string> {
  const pending = early.get(role) ?? fetchTicket(role);
  early.set(role, pending);
  pending.catch(() => {
    if (early.get(role) === pending) early.delete(role);
  });
  return pending;
}

function take(role: DemoRole): Promise<string> {
  const pending = warm(role);
  early.delete(role);
  return pending;
}

/**
 * "Enter as demo driver / insurer": the API hands out a one-time Clerk sign-in ticket for a
 * seeded demo account (minted ahead of time), and the page redeems it. No signup, no password.
 *
 * To keep the wait short: the ticket is asked for as soon as a finger or pointer reaches a
 * button, the destination page is prefetched, and the page says at once that it is signing in.
 */
export function DemoButtons() {
  const t = useTranslations("Auth");
  const { signIn } = useSignIn();
  const clerk = useClerk();
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
      const ticket = await take(role);
      // One session at a time: leave the current account before entering the demo one.
      if (clerk.isSignedIn) await clerk.signOut({ redirectUrl: undefined });
      const attempt = await signIn.ticket({ ticket });
      if (attempt.error) throw attempt.error;
      const done = await signIn.finalize();
      if (done.error) throw done.error;
      router.push(HOME[role]);
    } catch (cause) {
      const code = (cause as { code?: string }).code;
      setError(code === "rate_limited" || code === "demo_unavailable" ? t(`errors.${code}`) : t("errors.failed"));
      setBusy(null);
    }
  }

  const intent = (role: DemoRole) => ({
    onPointerEnter: () => void warm(role).catch(() => {}),
    onTouchStart: () => void warm(role).catch(() => {}),
    onFocus: () => void warm(role).catch(() => {}),
    onClick: () => enter(role),
  });

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
