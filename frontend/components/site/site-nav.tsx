import { useTranslations } from "next-intl";

import { AppLinks, AppUser } from "@/components/app/app-nav";
import { LanguagePill } from "@/components/language-switcher";
import { Mark } from "@/components/site/mark";
import { MobileMenu } from "@/components/site/mobile-menu";
import { pill } from "@/components/ui/pill";
import { Link } from "@/i18n/navigation";
import { REPOSITORY_URL } from "@/lib/site";

/** `full` is the landing-page nav; `minimal` is the app nav: sections for the role, language and user. */
export function SiteNav({ variant }: { variant: "full" | "minimal" }) {
  const t = useTranslations("Nav");

  const links = [
    { href: "/#how-it-works", label: t("howItWorks") },
    { href: "/#insurers", label: t("insurers") },
    { href: "/#scenarios", label: t("scenarios") },
    { href: REPOSITORY_URL, label: t("github"), external: true },
  ];

  return (
    <header className="sticky top-0 z-40 bg-paper">
      <div className="wide">
        <div className="grid h-[68px] grid-cols-[1fr_auto_1fr] items-center gap-4 md:px-8">
          <Link href="/" aria-label={t("home")} className="flex items-center gap-2 justify-self-start">
            <Mark className="size-5" />
            <span className="font-serif text-[1.375rem] leading-none tracking-[-0.01em]">{t("wordmark")}</span>
          </Link>

          <nav aria-label={t("sections")} className="hidden items-center gap-7 text-sm font-[450] md:flex">
            {variant === "full" &&
              links.map((link) =>
                link.external ? (
                  <a key={link.href} href={link.href} className="hover:text-gray">
                    {link.label}
                  </a>
                ) : (
                  <Link key={link.href} href={link.href} className="hover:text-gray">
                    {link.label}
                  </Link>
                ),
              )}
            {variant === "minimal" && <AppLinks />}
          </nav>

          <div className="col-start-3 flex items-center gap-2 justify-self-end">
            <LanguagePill className="max-md:hidden" />
            {variant === "minimal" && <AppUser />}
            {variant === "full" && (
              <>
                <Link href="/app" className={pill({ className: "max-md:hidden" })}>
                  {t("cta")}
                </Link>
                <MobileMenu
                  openLabel={t("openMenu")}
                  closeLabel={t("closeMenu")}
                  cta={{ href: "/app", label: t("cta") }}
                  items={links}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
