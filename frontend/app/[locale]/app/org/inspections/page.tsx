import { Suspense, use } from "react";
import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { OrgTablePage } from "@/components/app/org-table";
import { SiteNav } from "@/components/site/site-nav";
import { routing } from "@/i18n/routing";

/** Every inspection of the organization: filters, search, pages, CSV export. */
export default function Page({ params }: PageProps<"/[locale]/app/org/inspections">) {
  const { locale } = use(params);
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return (
    <>
      <SiteNav variant="minimal" />
      <main className="flex-1 pt-14 pb-24 md:pt-20">
        <Suspense>
          <OrgTablePage />
        </Suspense>
      </main>
    </>
  );
}
