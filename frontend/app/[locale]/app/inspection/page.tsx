import { Suspense, use } from "react";
import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { InspectionFromQuery } from "@/components/app/inspection-view";
import { SiteNav } from "@/components/site/site-nav";
import { routing } from "@/i18n/routing";

/**
 * One saved inspection, `/app/inspection?id=…`. The page is static; the id is read in the browser,
 * so there is no dynamic segment to render on the server.
 */
export default function InspectionPage({ params }: PageProps<"/[locale]/app/inspection">) {
  const { locale } = use(params);
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return (
    <>
      <SiteNav variant="minimal" />
      <main className="col flex-1 pt-14 pb-24 md:pt-20">
        <Suspense>
          <InspectionFromQuery />
        </Suspense>
      </main>
    </>
  );
}
