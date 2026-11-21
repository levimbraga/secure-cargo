"use client";

import { SignIn, useAuth } from "@clerk/nextjs";
import { useLocale, useTranslations } from "next-intl";

import { DemoButtons } from "@/components/app/demo-buttons";

const appearance = { elements: { rootBox: "w-full", cardBox: "shadow-none w-full max-w-[420px]" } };

/** The sign-in screen: demo access first (judges), then Clerk's own form (Google, email link). */
export function SignInPanel() {
  const t = useTranslations("Auth");
  const locale = useLocale();
  // Clerk's form sends a signed-in user away; keep this page reachable to switch demo accounts.
  const { isLoaded, isSignedIn } = useAuth();
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

      {isLoaded && !isSignedIn && (
        <>
          <h2 className="type-label mt-14">{t("orLabel")}</h2>
          <div className="mt-4">
            {/* Hash routing: the sign-in steps live in the fragment, so the page stays static. */}
            <SignIn routing="hash" signUpUrl={`${prefix}/app/sign-up`} appearance={appearance} />
          </div>
        </>
      )}
    </div>
  );
}
