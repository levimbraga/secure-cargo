import { Suspense, use } from "react";
import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { VerifyFromUrl } from "@/components/verify-view";
import { SiteNav } from "@/components/site/site-nav";
import { routing } from "@/i18n/routing";

/**
 * The public check of a load certificate, `securecargo.app/verify/<id>` (the QR on the
 * certificate). `proxy.ts` rewrites `/verify/<id>` to this static page; the id is read in the
 * browser. No sign-in: only authenticity and a minimal summary.
 */
export default function VerifyPage({ params }: PageProps<"/[locale]/verify">) {
  const { locale } = use(params);
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return (
    <>
      <SiteNav variant="minimal" />
      <main className="col flex-1 pt-10 pb-24 md:pt-16">
        <Suspense>
          <VerifyFromUrl />
        </Suspense>
      </main>
    </>
  );
}
