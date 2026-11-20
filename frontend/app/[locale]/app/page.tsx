import { use } from "react";
import { hasLocale, useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { ExampleRows } from "@/components/app/example-links";
import { HealthStatus } from "@/components/health-status";
import { SiteNav } from "@/components/site/site-nav";
import { pill } from "@/components/ui/pill";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { DEMO_IDS } from "@/lib/demo";
import { explorerQueries } from "@/lib/gallery";

export default function AppPage({ params }: PageProps<"/[locale]/app">) {
  const { locale } = use(params);
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = useTranslations("App");
  const home = useTranslations("AppHome");

  return (
    <>
      <SiteNav variant="minimal" />
      <main className="col flex-1 pt-14 pb-24 md:pt-20">
        <section>
          <p className="type-label">{home("label")}</p>
          <h1 className="type-hero mt-5 text-balance">{home("title")}</h1>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/app/explorer" className={pill({ className: "max-sm:h-11" })}>
              {home("explorer")}
            </Link>
            <Link href="/app/examples" className={pill({ variant: "secondary", className: "max-sm:h-11" })}>
              {home("examples")}
            </Link>
          </div>
        </section>

        <section className="mt-14">
          <h2 className="type-label">{home("listLabel")}</h2>
          <div className="mt-3">
            <ExampleRows ids={DEMO_IDS} explorer={explorerQueries("as_loaded")} />
          </div>
        </section>

        <div className="mt-20">
          <HealthStatus />
        </div>
        <p className="type-small mt-10 text-gray">{t("note")}</p>
      </main>
    </>
  );
}
