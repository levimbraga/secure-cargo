"use client";

import { cn } from "cn";
import { useLocale, useTranslations } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

/** Links to the current page in each locale. Plain links, so it works before hydration too. */
export function LanguageSwitcher() {
  const t = useTranslations("LanguageSwitcher");
  const activeLocale = useLocale();
  const pathname = usePathname();

  return (
    <nav
      aria-label={t("label")}
      className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5 text-sm font-medium"
    >
      {routing.locales.map((locale) => {
        const isActive = locale === activeLocale;
        return (
          <Link
            key={locale}
            href={pathname}
            locale={locale}
            hrefLang={locale}
            lang={locale}
            title={t(locale)}
            aria-label={t(locale)}
            aria-current={isActive ? "true" : undefined}
            className={cn(
              "flex h-8 min-w-10 items-center justify-center rounded-md px-2.5 transition-colors",
              isActive
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(`${locale}Short`)}
          </Link>
        );
      })}
    </nav>
  );
}
