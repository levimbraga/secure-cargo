import { Suspense, use } from "react";
import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { OrgOverviewPage } from "@/components/app/org-overview";
import { SiteNav } from "@/components/site/site-nav";
import { routing } from "@/i18n/routing";

/** The manager's overview: where the risk is in the fleet (desktop-first). */
export default function Page({ params }: PageProps<"/[locale]/app/org">) {
  const { locale } = use(params);
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return (
    <>
      <SiteNav variant="minimal" />
      <main className="flex-1 pt-14 pb-24 md:pt-20">
        <Suspense>
          <OrgOverviewPage />
        </Suspense>
      </main>
    </>
  );
}
