import type { Metadata, Viewport } from "next";
import { Fragment_Mono, Inter, Newsreader } from "next/font/google";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { SiteFooter } from "@/components/site/site-footer";
import { routing } from "@/i18n/routing";

import "../globals.css";

const sans = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const serif = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  display: "swap",
  // Two static weights are a fraction of the size of the variable font.
  weight: ["400", "500"],
});
const mono = Fragment_Mono({
  variable: "--font-fragment-mono",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
  // Only used for small labels and data values: not worth a preload.
  preload: false,
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

const OG_IMAGE = {
  url: "/og.png",
  width: 1200,
  height: 630,
  alt: "SecureCargo: physics-tested cargo securement",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f8f8f3",
};

export async function generateMetadata({
  params,
}: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};

  const t = await getTranslations({ locale, namespace: "Metadata" });
  return {
    metadataBase: new URL("https://securecargo.app"),
    title: t("title"),
    description: t("description"),
    // Link previews (WhatsApp, LinkedIn, X). A file in `public/` keeps the image URL stable; the
    // file-based `opengraph-image.png` under `[locale]` is served at `/-/...`.
    openGraph: {
      type: "website",
      siteName: "SecureCargo",
      title: t("title"),
      description: t("description"),
      locale: locale === "pt-BR" ? "pt_BR" : "en_US",
      images: [OG_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: t("title"),
      description: t("description"),
      images: [OG_IMAGE],
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  // Lets next-intl resolve the locale without request headers, so pages stay static.
  setRequestLocale(locale);

  return (
    <html
      lang={locale}
      className={`${sans.variable} ${mono.variable} ${serif.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <NextIntlClientProvider>
          {children}
          <SiteFooter />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
