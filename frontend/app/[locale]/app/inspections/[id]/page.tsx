import { use } from "react";
import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { InspectionView } from "@/components/app/inspection-view";
import { SiteNav } from "@/components/site/site-nav";
import { routing } from "@/i18n/routing";

export default function InspectionPage({ params }: PageProps<"/[locale]/app/inspections/[id]">) {
  const { locale, id } = use(params);
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return (
    <>
      <SiteNav variant="minimal" />
      <main className="col flex-1 pt-14 pb-24 md:pt-20">
        <InspectionView id={id} />
      </main>
    </>
  );
}
