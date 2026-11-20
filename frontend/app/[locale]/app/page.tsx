import { use } from "react";
import { hasLocale, useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { HealthStatus } from "@/components/health-status";
import { routing } from "@/i18n/routing";

export default function AppPage({ params }: PageProps<"/[locale]/app">) {
  const { locale } = use(params);
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = useTranslations("App");

  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-5 py-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("lead")}</p>
      </div>
      <HealthStatus />
    </div>
  );
}
