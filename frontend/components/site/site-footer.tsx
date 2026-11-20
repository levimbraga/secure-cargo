import { useTranslations } from "next-intl";

import { LanguageSwitcher } from "@/components/language-switcher";
import { HACKATHON_URL, REPOSITORY_URL } from "@/lib/site";

export function SiteFooter() {
  const t = useTranslations("Footer");
  const link = "underline decoration-1 underline-offset-4 hover:decoration-2";

  return (
    <footer className="border-t border-hairline">
      <div className="shell flex flex-col gap-6 py-10 md:flex-row md:items-start md:justify-between">
        <div className="flex max-w-reading flex-col gap-2">
          <p className="font-serif text-2xl leading-none">{t("wordmark")}</p>
          <p className="type-small text-muted-foreground">{t("disclaimer")}</p>
        </div>
        <div className="flex items-center gap-6 text-[0.9375rem]">
          <a href={REPOSITORY_URL} className={link}>
            {t("github")}
          </a>
          <a href={HACKATHON_URL} className={link}>
            {t("hackathon")}
          </a>
          <LanguageSwitcher />
        </div>
      </div>
    </footer>
  );
}
