"use client";

import { useClerk, useSignIn } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { pill } from "@/components/ui/pill";
import { useRouter } from "@/i18n/navigation";
import { API_URL } from "@/lib/api";
import { readError } from "@/lib/app-api";

type DemoRole = "driver" | "insurer";

/**
 * "Enter as demo driver / insurer": the API mints a one-time Clerk sign-in ticket for a seeded
 * demo account, and the page redeems it. No signup, no password.
 */
export function DemoButtons() {
  const t = useTranslations("Auth");
  const { signIn } = useSignIn();
  const clerk = useClerk();
  const router = useRouter();
  const [busy, setBusy] = useState<DemoRole | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function enter(role: DemoRole) {
    setBusy(role);
    setError(null);
    try {
      const response = await fetch(`${API_URL}/demo/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ as: role }),
      });
      if (!response.ok) throw await readError(response);
      const { ticket } = (await response.json()) as { ticket: string };
      // One session at a time: leave the current account before entering the demo one.
      if (clerk.isSignedIn) await clerk.signOut({ redirectUrl: undefined });
      const attempt = await signIn.ticket({ ticket });
      if (attempt.error) throw attempt.error;
      const done = await signIn.finalize();
      if (done.error) throw done.error;
      router.push(role === "insurer" ? "/app/org" : "/app");
    } catch (cause) {
      const code = (cause as { code?: string }).code;
      setError(code === "rate_limited" || code === "demo_unavailable" ? t(`errors.${code}`) : t("errors.failed"));
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={busy !== null} onClick={() => enter("driver")} className={pill({ className: "h-11 px-4" })}>
          {busy === "driver" ? t("entering") : t("demoDriver")}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => enter("insurer")}
          className={pill({ variant: "secondary", className: "h-11 px-4" })}
        >
          {busy === "insurer" ? t("entering") : t("demoInsurer")}
        </button>
      </div>
      <p className="type-small mt-3 text-gray">{t("demoNote")}</p>
      {error && (
        <p role="alert" className="type-small mt-3 text-fail">
          {error}
        </p>
      )}
    </div>
  );
}
