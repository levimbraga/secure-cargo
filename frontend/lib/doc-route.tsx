import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { DocPage } from "@/components/site/doc-page";
import { SiteNav } from "@/components/site/site-nav";
import { routing } from "@/i18n/routing";
import { LEGAL_PAGES, PAGE_UPDATED, type PageKey, pageContent } from "@/lib/page-content";

type Params = { params: Promise<{ locale: string }> };

/** The metadata and the page of one long-form route (`/privacy`, `/terms`, ...), both static. */
export function docRoute(key: PageKey) {
  async function generateMetadata({ params }: Params): Promise<Metadata> {
    const { locale } = await params;
    if (!hasLocale(routing.locales, locale)) return {};
    const content = await pageContent(locale, key);
    const path = locale === routing.defaultLocale ? `/${key}` : `/${locale}/${key}`;
    return {
      title: `${content.title.replace(/\.$/, "")} · SecureCargo`,
      description: content.description,
      alternates: { canonical: path, languages: { en: `/${key}`, "pt-BR": `/pt-BR/${key}` } },
    };
  }

  async function Page({ params }: Params) {
    const { locale } = await params;
    if (!hasLocale(routing.locales, locale)) notFound();
    setRequestLocale(locale);
    const content = await pageContent(locale, key);
    return (
      <>
        <SiteNav variant="full" />
        <DocPage content={content} updated={PAGE_UPDATED[key]} legal={LEGAL_PAGES.includes(key)} />
      </>
    );
  }

  return { generateMetadata, Page };
}
