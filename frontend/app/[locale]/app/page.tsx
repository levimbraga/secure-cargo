import { use } from "react";
import { hasLocale, useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { HealthStatus } from "@/components/health-status";
import { SiteNav } from "@/components/site/site-nav";
import { routing } from "@/i18n/routing";

export default function AppPage({ params }: PageProps<"/[locale]/app">) {
  const { locale } = use(params);
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = useTranslations("App");

  return (
    <>
      <SiteNav variant="minimal" />
      <main className="col flex-1 pt-14 md:pt-20">
        <HealthStatus />
        <p className="type-small mt-10 text-gray">{t("note")}</p>
      </main>
    </>
  );
}
