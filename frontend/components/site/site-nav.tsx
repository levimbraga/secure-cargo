import { useTranslations } from "next-intl";

import { LanguageSwitcher } from "@/components/language-switcher";
import { MobileMenu } from "@/components/site/mobile-menu";
import { pill } from "@/components/ui/pill";
import { Link } from "@/i18n/navigation";
import { REPOSITORY_URL } from "@/lib/site";

/** `full` is the landing-page nav; `minimal` is the app nav (wordmark and language only). */
export function SiteNav({ variant }: { variant: "full" | "minimal" }) {
  const t = useTranslations("Nav");

  const links = [
    { href: "/#how-it-works", label: t("howItWorks") },
    { href: "/#demo", label: t("demo") },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-hairline bg-paper">
      <div className="shell flex h-16 items-center justify-between gap-3">
        <Link
          href="/"
          aria-label={t("home")}
          className="font-serif text-[1.625rem] leading-none"
        >
          {t("wordmark")}
        </Link>

        <div className="flex items-center gap-1 md:gap-2">
          {variant === "full" && (
            <nav
              aria-label={t("sections")}
              className="mr-2 hidden items-center gap-7 text-[0.9375rem] md:flex"
            >
              {links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="hover:underline hover:underline-offset-4"
                >
                  {link.label}
                </Link>
              ))}
              <a
                href={REPOSITORY_URL}
                className="hover:underline hover:underline-offset-4"
              >
                {t("github")}
              </a>
            </nav>
          )}

          <LanguageSwitcher />

          {variant === "full" && (
            <>
              <Link
                href="/app"
                className={pill({
                  size: "sm",
                  className: "ml-1 max-sm:hidden",
                })}
              >
                {t("cta")}
              </Link>
              <MobileMenu
                openLabel={t("openMenu")}
                closeLabel={t("closeMenu")}
                items={[
                  ...links,
                  { href: REPOSITORY_URL, label: t("github"), external: true },
                  { href: "/app", label: t("cta") },
                ]}
              />
            </>
          )}
        </div>
      </div>
    </header>
  );
}
