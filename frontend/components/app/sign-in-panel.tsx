"use client";

import { useTranslations } from "next-intl";

import { AuthPanel, type AuthTab } from "@/components/app/auth-panel";
import { AUTH_ENABLED } from "@/lib/auth-config";

/** The sign-in screen: email + password (two tabs), then the demo buttons under "Just looking?". */
export function SignInPanel({ initial = "sign-in" }: { initial?: AuthTab }) {
  return AUTH_ENABLED ? <AuthPanel initial={initial} /> : <SignInUnavailable />;
}

function SignInUnavailable() {
  const t = useTranslations("Auth");
  return (
    <div>
      <p className="type-label">{t("label")}</p>
      <h1 className="type-hero mt-5 text-balance">{t("title")}</h1>
      <p className="type-body mt-5">{t("unavailable")}</p>
    </div>
  );
}
