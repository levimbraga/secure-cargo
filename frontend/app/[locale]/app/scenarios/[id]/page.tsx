import type { Metadata } from "next";
import { use } from "react";
import { hasLocale, useTranslations } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { ScenarioReplay } from "@/components/scenario/scenario-replay";
import { SiteNav } from "@/components/site/site-nav";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { DEMO_IDS, isDemoId } from "@/lib/demo";
import { demoSummary } from "@/lib/demo-summaries";

export function generateStaticParams() {
  return DEMO_IDS.map((id) => ({ id }));
}

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/app/scenarios/[id]">): Promise<Metadata> {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale) || !isDemoId(id)) return {};
  const t = await getTranslations({ locale, namespace: "Scenario" });
  return {
    title: `${t(`titles.${id}`)} · SecureCargo`,
    description: t(`sentences.${id}.as_loaded`),
  };
}

export default function ScenarioPage({ params }: PageProps<"/[locale]/app/scenarios/[id]">) {
  const { locale, id } = use(params);
  if (!hasLocale(routing.locales, locale) || !isDemoId(id)) notFound();
  setRequestLocale(locale);

  const t = useTranslations("Scenario");
  const summary = demoSummary(id);

  return (
    <>
      <SiteNav variant="minimal" />
      <main className="col flex-1 pt-14 pb-24 md:pt-20">
        <ScenarioReplay id={summary.id} event={summary.event} runs={summary.runs} />

        <nav aria-label={t("others")} className="mt-16">
          <h2 className="type-label">{t("others")}</h2>
          <ul className="mt-3 border-b border-hairline">
            {DEMO_IDS.filter((other) => other !== id).map((other) => (
              <li key={other} className="border-t border-hairline">
                <Link
                  href={`/app/scenarios/${other}`}
                  className="flex min-h-11 items-center py-2.5 hover:underline hover:decoration-1 hover:underline-offset-4"
                >
                  {t(`titles.${other}`)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </main>
    </>
  );
}
