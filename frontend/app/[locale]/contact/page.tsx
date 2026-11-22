import type { Metadata } from "next";
import { use } from "react";
import { hasLocale, useTranslations } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { ContactForm } from "@/components/site/contact-form";
import { SiteNav } from "@/components/site/site-nav";
import { SectionLabel } from "@/components/ui/section-label";
import { routing } from "@/i18n/routing";

export async function generateMetadata({ params }: PageProps<"/[locale]/contact">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Contact" });
  return {
    title: `${t("title").replace(/\.$/, "")} · SecureCargo`,
    description: t("description"),
    alternates: { canonical: locale === routing.defaultLocale ? "/contact" : `/${locale}/contact`, languages: { en: "/contact", "pt-BR": "/pt-BR/contact" } },
  };
}

/**
 * The contact form. No email address appears on the site: the Worker emails the message to the
 * owner (`POST /contact`), with Reply-To set to the visitor.
 */
export default function ContactPage({ params }: PageProps<"/[locale]/contact">) {
  const { locale } = use(params);
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = useTranslations("Contact");
  return (
    <>
      <SiteNav variant="full" />
      <main className="col relative flex-1 pt-10 pb-8 md:pt-16">
        <SectionLabel>{t("label")}</SectionLabel>
        <h1 className="type-hero mt-5">{t("title")}</h1>
        <p className="type-body mt-4 max-w-[34rem] text-pretty">{t("intro")}</p>
        <div className="max-w-[34rem]">
          <ContactForm />
        </div>
      </main>
    </>
  );
}
