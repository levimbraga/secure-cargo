import { use } from "react";
import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { AdminView } from "@/components/app/admin-view";
import { SiteNav } from "@/components/site/site-nav";
import { routing } from "@/i18n/routing";

/** The platform admin's view: usage, quotas, kill switch (desktop-first). */
export default function AdminPage({ params }: PageProps<"/[locale]/app/admin">) {
  const { locale } = use(params);
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return (
    <>
      <SiteNav variant="minimal" />
      <main className="flex-1 pt-14 pb-24 md:pt-20">
        <AdminView />
      </main>
    </>
  );
}
