import { Suspense, use } from "react";
import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { CertificateFromQuery } from "@/components/app/certificate-view";
import { SiteNav } from "@/components/site/site-nav";
import { routing } from "@/i18n/routing";

/** A load certificate, `/app/certificate?id=SC-…` (static page; the id is read in the browser). */
export default function Page({ params }: PageProps<"/[locale]/app/certificate">) {
  const { locale } = use(params);
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return (
    <>
      <SiteNav variant="minimal" />
      <main className="flex-1 pt-14 pb-24 md:pt-20">
        <Suspense>
          <CertificateFromQuery />
        </Suspense>
      </main>
    </>
  );
}
