"use client";

import { cn } from "cn";
import { useLocale, useTranslations } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

/** Links to the current page in each locale. Plain links, so it works before hydration too. */
export function LanguageSwitcher({ className }: { className?: string }) {
  const t = useTranslations("LanguageSwitcher");
  const activeLocale = useLocale();
  const pathname = usePathname();

  return (
    <nav
      aria-label={t("label")}
      className={cn("flex items-center font-mono text-sm", className)}
    >
      {routing.locales.map((locale) => {
        const isActive = locale === activeLocale;
        return (
          <Link
            key={locale}
            href={pathname}
            locale={locale}
            hrefLang={locale}
            aria-current={isActive ? "true" : undefined}
            className={cn(
              "flex h-10 min-w-9 items-center justify-center rounded-full px-1.5 transition-colors duration-100",
              isActive
                ? "text-ink underline decoration-1 underline-offset-4"
                : "text-muted-foreground hover:text-ink",
            )}
          >
            {t(`${locale}Short`)}
            <span className="sr-only">, {t(locale)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
