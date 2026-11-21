import { Suspense, use } from "react";
import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { NewInspection } from "@/components/inspection/new-inspection";
import { SiteNav } from "@/components/site/site-nav";
import { routing } from "@/i18n/routing";

/** A new inspection: photos, truck and weight, review, the seven-situation battery and the fix. */
export default function NewInspectionPage({ params }: PageProps<"/[locale]/app/new">) {
  const { locale } = use(params);
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return (
    <>
      <SiteNav variant="minimal" />
      <main className="col flex-1 pt-10 pb-24 md:pt-16 lg:max-w-[72rem]">
        <Suspense>
          <NewInspection />
        </Suspense>
      </main>
    </>
  );
}
