import { use } from "react";
import { hasLocale, useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { HealthStatus } from "@/components/health-status";
import { SiteNav } from "@/components/site/site-nav";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { DEMO_IDS } from "@/lib/demo";
import { demoSummary } from "@/lib/demo-summaries";

export default function AppPage({ params }: PageProps<"/[locale]/app">) {
  const { locale } = use(params);
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = useTranslations("App");
  const scenario = useTranslations("Scenario");

  return (
    <>
      <SiteNav variant="minimal" />
      <main className="col flex-1 pt-14 pb-24 md:pt-20">
        <section>
          <p className="type-label">{scenario("list.label")}</p>
          <h1 className="type-hero mt-5 text-balance">{scenario("list.title")}</h1>
          <ul className="mt-7 border-b border-hairline">
            {DEMO_IDS.map((id) => (
              <li key={id} className="border-t border-hairline">
                <Link
                  href={`/app/scenarios/${id}`}
                  className="flex min-h-11 items-center justify-between gap-6 py-2.5 hover:underline hover:decoration-1 hover:underline-offset-4"
                >
                  <span>{scenario(`titles.${id}`)}</span>
                  <span className="text-right font-mono text-[0.8125rem] text-gray">
                    {scenario(`events.${id}`, { speed: demoSummary(id).event.speed_kmh })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <div className="mt-20">
          <HealthStatus />
        </div>
        <p className="type-small mt-10 text-gray">{t("note")}</p>
      </main>
    </>
  );
}
