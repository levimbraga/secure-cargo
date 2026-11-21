import { Suspense, use } from "react";
import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { OrgTeamPage } from "@/components/app/org-view";
import { SiteNav } from "@/components/site/site-nav";
import { routing } from "@/i18n/routing";

/** Members, invitations and the organization's policies. */
export default function Page({ params }: PageProps<"/[locale]/app/org/team">) {
  const { locale } = use(params);
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return (
    <>
      <SiteNav variant="minimal" />
      <main className="flex-1 pt-14 pb-24 md:pt-20">
        <Suspense>
          <OrgTeamPage />
        </Suspense>
      </main>
    </>
  );
}
