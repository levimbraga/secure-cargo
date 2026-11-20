import { useTranslations } from "next-intl";

import { LanguageSwitcher } from "@/components/language-switcher";
import { Link } from "@/i18n/navigation";

export function SiteHeader() {
  const t = useTranslations("Header");

  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-5">
        <Link
          href="/"
          aria-label={t("home")}
          className="flex items-center gap-2 font-semibold tracking-tight"
        >
          <span aria-hidden className="h-4 w-1.5 rounded-sm bg-brand" />
          {t("brand")}
        </Link>
        <LanguageSwitcher />
      </div>
    </header>
  );
}
