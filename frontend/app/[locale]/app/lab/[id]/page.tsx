import type { Metadata } from "next";
import { use } from "react";
import { hasLocale, useTranslations } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { LiveLab } from "@/components/lab/live-lab";
import { SiteNav } from "@/components/site/site-nav";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { DEMO_IDS, isDemoId } from "@/lib/demo";

export function generateStaticParams() {
  return DEMO_IDS.map((id) => ({ id }));
}

export async function generateMetadata({ params }: PageProps<"/[locale]/app/lab/[id]">): Promise<Metadata> {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale) || !isDemoId(id)) return {};
  const t = await getTranslations({ locale, namespace: "Lab" });
  const scenario = await getTranslations({ locale, namespace: "Scenario" });
  return {
    title: t("metaTitle", { title: scenario(`titles.${id}`) }),
    description: t("description"),
  };
}

/**
 * The live lab of a demo scenario. The page is static; the version of the load (`?variant=`),
 * the simulation and the scene all happen in the browser (`LiveLab`).
 */
export default function LabPage({ params }: PageProps<"/[locale]/app/lab/[id]">) {
  const { locale, id } = use(params);
  if (!hasLocale(routing.locales, locale) || !isDemoId(id)) notFound();
  setRequestLocale(locale);

  const t = useTranslations("Lab");
  const scenario = useTranslations("Scenario");

  return (
    <>
      <SiteNav variant="minimal" />
      <main className="wide flex-1 pt-10 pb-24 md:pt-14">
        <LiveLab id={id} />

        <nav aria-label={t("others")} className="mx-auto mt-16 max-w-[43rem] lg:mx-0">
          <h2 className="type-label">{t("others")}</h2>
          <ul className="mt-3 border-b border-hairline">
            {DEMO_IDS.filter((other) => other !== id).map((other) => (
              <li key={other} className="border-t border-hairline">
                <Link
                  href={`/app/lab/${other}`}
                  className="flex min-h-11 items-center py-2.5 hover:underline hover:decoration-1 hover:underline-offset-4"
                >
                  {scenario(`titles.${other}`)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </main>
    </>
  );
}
