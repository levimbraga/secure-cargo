import { use } from "react";
import { hasLocale, useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { SiteNav } from "@/components/site/site-nav";
import { pill } from "@/components/ui/pill";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

/** Shell of the inspection flow (photos, weight, truck); the flow itself is the next step. */
export default function NewInspectionPage({ params }: PageProps<"/[locale]/app/inspections/new">) {
  const { locale } = use(params);
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = useTranslations("NewInspection");

  return (
    <>
      <SiteNav variant="minimal" />
      <main className="col flex-1 pt-14 pb-24 md:pt-20">
        <p className="type-label">{t("label")}</p>
        <h1 className="type-hero mt-5 text-balance">{t("title")}</h1>
        <p className="type-body mt-5">{t("sentence")}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/app/explorer" className={pill({ className: "h-11 px-4" })}>
            {t("explorer")}
          </Link>
          <Link href="/app/examples" className={pill({ variant: "secondary", className: "h-11 px-4" })}>
            {t("examples")}
          </Link>
        </div>
      </main>
    </>
  );
}
