"use client";

import { SignIn } from "@clerk/nextjs";
import { useLocale, useTranslations } from "next-intl";

import { DemoButtons } from "@/components/app/demo-buttons";

const appearance = { elements: { rootBox: "w-full", cardBox: "shadow-none w-full max-w-[420px]" } };

/** The sign-in screen: demo access first (judges), then Clerk's own form (Google, email link). */
export function SignInPanel({ mode = "sign-in" }: { mode?: "sign-in" | "embedded" }) {
  const t = useTranslations("Auth");
  const locale = useLocale();
  const prefix = locale === "pt-BR" ? "/pt-BR" : "";
  return (
    <div>
      <p className="type-label">{t("label")}</p>
      <h1 className="type-hero mt-5 text-balance">{t("title")}</h1>
      <p className="type-body mt-5">{t("sentence")}</p>

      <h2 className="type-label mt-12">{t("demoLabel")}</h2>
      <div className="mt-4">
        <DemoButtons />
      </div>

      <h2 className="type-label mt-14">{t("orLabel")}</h2>
      <div className="mt-4">
        {mode === "sign-in" ? (
          <SignIn routing="path" path={`${prefix}/app/sign-in`} signUpUrl={`${prefix}/app/sign-up`} appearance={appearance} />
        ) : (
          <SignIn routing="hash" signUpUrl={`${prefix}/app/sign-up`} appearance={appearance} />
        )}
      </div>
    </div>
  );
}
