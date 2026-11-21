import { Suspense, use } from "react";
import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { OrgAlertsPage } from "@/components/app/org-alerts";
import { SiteNav } from "@/components/site/site-nav";
import { routing } from "@/i18n/routing";

/** Failed or out of compliance, with no proven fix after the organization's N hours. */
export default function Page({ params }: PageProps<"/[locale]/app/org/alerts">) {
  const { locale } = use(params);
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return (
    <>
      <SiteNav variant="minimal" />
      <main className="flex-1 pt-14 pb-24 md:pt-20">
        <Suspense>
          <OrgAlertsPage />
        </Suspense>
      </main>
    </>
  );
}
