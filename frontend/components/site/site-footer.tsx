import { useTranslations } from "next-intl";

import { LanguageLinks } from "@/components/language-switcher";
import { Mark } from "@/components/site/mark";
import { Link } from "@/i18n/navigation";
import { REPOSITORY_URL } from "@/lib/site";

type FooterLink = { href: string; label: string; external?: boolean };

/**
 * Every page's footer: the wordmark, four columns (product, resources, legal, contact) and a
 * bottom line with the disclaimer and the language switch. On a phone the columns stack.
 */
export function SiteFooter() {
  const t = useTranslations("Footer");
  const link = "text-gray hover:text-ink";

  const columns: { title: string; links: FooterLink[] }[] = [
    {
      title: t("product"),
      links: [
        { href: "/#how-it-works", label: t("howItWorks") },
        { href: "/app/examples", label: t("examples") },
        { href: "/app/explorer", label: t("explorer") },
        { href: "/#insurers", label: t("insurers") },
      ],
    },
    {
      title: t("resources"),
      links: [
        { href: "/methodology", label: t("methodology") },
        { href: "/rules", label: t("rules") },
        { href: REPOSITORY_URL, label: t("github"), external: true },
      ],
    },
    {
      title: t("legal"),
      links: [
        { href: "/privacy", label: t("privacy") },
        { href: "/terms", label: t("terms") },
        { href: "/cookies", label: t("cookies") },
      ],
    },
    { title: t("contact"), links: [{ href: "/contact", label: t("contactUs") }] },
  ];

  return (
    <footer className="mt-32 pb-12">
      <div className="wide">
        <div className="flex flex-col gap-10 md:flex-row md:items-start md:justify-between md:px-8">
          <p className="flex items-center gap-2">
            <Mark className="size-5" />
            <span className="font-serif text-[1.375rem] leading-none tracking-[-0.01em]">{t("wordmark")}</span>
          </p>

          <nav aria-label={t("columns")} className="grid grid-cols-1 gap-x-16 gap-y-8 text-[0.8125rem] sm:grid-cols-2 md:grid-cols-4">
            {columns.map((column) => (
              <div key={column.title}>
                <p className="font-medium">{column.title}</p>
                <ul className="mt-3 flex flex-col gap-2">
                  {column.links.map((item) => (
                    <li key={item.href}>
                      {item.external ? (
                        <a href={item.href} className={link}>
                          {item.label}
                        </a>
                      ) : (
                        <Link href={item.href} className={link}>
                          {item.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <div className="mt-14 flex flex-col gap-4 text-[0.8125rem] text-gray md:flex-row md:items-center md:justify-between md:px-8">
          <p className="text-pretty">
            {t("copyright")} · {t("disclaimer")}
          </p>
          <LanguageLinks className="flex gap-4" linkClassName={link} />
        </div>
      </div>
    </footer>
  );
}
