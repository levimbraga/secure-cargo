import { useTranslations } from "next-intl";

import { LanguageLinks } from "@/components/language-switcher";
import { Mark } from "@/components/site/mark";
import { REPOSITORY_URL } from "@/lib/site";

export function SiteFooter() {
  const t = useTranslations("Footer");
  const link = "text-gray hover:text-ink";

  return (
    <footer className="mt-32 pb-16">
      <div className="wide">
        <div className="flex flex-col gap-10 md:flex-row md:items-start md:justify-between md:px-8">
          <p className="flex items-center gap-2">
            <Mark className="size-5" />
            <span className="font-serif text-[1.375rem] leading-none tracking-[-0.01em]">{t("wordmark")}</span>
          </p>

          <div className="flex flex-wrap gap-x-16 gap-y-8 text-[0.8125rem]">
            <div>
              <p className="font-medium">{t("project")}</p>
              <ul className="mt-3 flex flex-col gap-2">
                <li>
                  <a href={REPOSITORY_URL} className={link}>
                    {t("github")}
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <p className="font-medium">{t("language")}</p>
              <LanguageLinks className="mt-3 flex flex-col gap-2" linkClassName={link} />
            </div>
            <p className="max-w-[16rem] text-gray">{t("disclaimer")}</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
