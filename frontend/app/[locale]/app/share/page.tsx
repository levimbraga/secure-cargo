import { Suspense, use } from "react";
import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { SharedInspectionFromQuery } from "@/components/app/shared-inspection";
import { SiteNav } from "@/components/site/site-nav";
import { routing } from "@/i18n/routing";

/**
 * The public summary of a shared inspection, `/app/share?t=…`: verdict, photo and main checks,
 * no sign-in. Static; the token is read in the browser.
 */
export default function SharePage({ params }: PageProps<"/[locale]/app/share">) {
  const { locale } = use(params);
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return (
    <>
      <SiteNav variant="minimal" />
      <main className="col flex-1 pt-10 pb-24 md:pt-16">
        <Suspense>
          <SharedInspectionFromQuery />
        </Suspense>
      </main>
    </>
  );
}
