"use client";

import { cn } from "cn";
import { useLocale, useTranslations } from "next-intl";

import { pill } from "@/components/ui/pill";
import { Link, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

/** A small pill that switches to the other language. A plain link, so it works before hydration. */
export function LanguagePill({ className }: { className?: string }) {
  const t = useTranslations("LanguageSwitcher");
  const activeLocale = useLocale();
  const pathname = usePathname();
  const other = routing.locales.find((locale) => locale !== activeLocale) ?? routing.defaultLocale;

  return (
    <Link
      href={pathname}
      locale={other}
      hrefLang={other}
      lang={other}
      className={pill({ variant: "secondary", className })}
    >
      {t(other)}
    </Link>
  );
}

/** Both languages as text links, for the footer and the phone menu. */
export function LanguageLinks({ className, linkClassName }: { className?: string; linkClassName?: string }) {
  const t = useTranslations("LanguageSwitcher");
  const activeLocale = useLocale();
  const pathname = usePathname();

  return (
    <ul aria-label={t("label")} className={className}>
      {routing.locales.map((locale) => (
        <li key={locale}>
          <Link
            href={pathname}
            locale={locale}
            hrefLang={locale}
            lang={locale}
            aria-current={locale === activeLocale ? "true" : undefined}
            className={cn(linkClassName, locale === activeLocale && "text-ink")}
          >
            {t(locale)}
          </Link>
        </li>
      ))}
    </ul>
  );
}
