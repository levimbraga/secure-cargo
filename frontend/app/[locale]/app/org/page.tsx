import { use } from "react";
import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { OrgView } from "@/components/app/org-view";
import { SiteNav } from "@/components/site/site-nav";
import { routing } from "@/i18n/routing";

/** The manager's view of the organization (desktop-first). */
export default function OrgPage({ params }: PageProps<"/[locale]/app/org">) {
  const { locale } = use(params);
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return (
    <>
      <SiteNav variant="minimal" />
      <main className="flex-1 pt-14 pb-24 md:pt-20">
        <OrgView />
      </main>
    </>
  );
}
