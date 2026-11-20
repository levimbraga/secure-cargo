import type { Metadata } from "next";
import { use } from "react";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { Explorer } from "@/components/explorer/explorer";
import { SiteNav } from "@/components/site/site-nav";
import { routing } from "@/i18n/routing";

export async function generateMetadata({ params }: PageProps<"/[locale]/app/explorer">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Explorer" });
  return { title: t("metaTitle"), description: t("description") };
}

/**
 * The explorer. The page is static; the configuration (the query string, or a draft in the
 * fragment), the load, the simulation and the scene all live in the browser.
 */
export default function ExplorerPage({ params }: PageProps<"/[locale]/app/explorer">) {
  const { locale } = use(params);
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return (
    <>
      <SiteNav variant="minimal" />
      <main className="wide flex-1 pt-10 pb-24 md:pt-14">
        <Explorer />
      </main>
    </>
  );
}
