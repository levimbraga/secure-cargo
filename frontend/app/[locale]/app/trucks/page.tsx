import { use } from "react";
import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { MyTrucks } from "@/components/app/my-trucks";
import { SiteNav } from "@/components/site/site-nav";
import { routing } from "@/i18n/routing";

/** "My trucks": the driver's saved trucks, picked before the photo of an inspection. */
export default function TrucksPage({ params }: PageProps<"/[locale]/app/trucks">) {
  const { locale } = use(params);
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return (
    <>
      <SiteNav variant="minimal" />
      <main className="col flex-1 pt-10 pb-24 md:pt-16">
        <MyTrucks />
      </main>
    </>
  );
}
