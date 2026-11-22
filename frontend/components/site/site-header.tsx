import { cn } from "cn";
import { useTranslations } from "next-intl";

import { LanguagePill } from "@/components/language-switcher";
import { HideOnScroll } from "@/components/site/hide-on-scroll";
import { Mark } from "@/components/site/mark";
import { MobileMenu } from "@/components/site/mobile-menu";
import { SignInLink, SiteLinks } from "@/components/site/site-links";
import { TryDemo } from "@/components/site/try-demo";
import { Link } from "@/i18n/navigation";

/** The site's sections for visitors. No GitHub here (footer only) and no app pages. */
export function useSiteLinks() {
  const t = useTranslations("Nav");
  return [
    { href: "/#how-it-works", label: t("howItWorks") },
    { href: "/#insurers", label: t("insurers") },
    { href: "/app/examples", label: t("examples") },
    { href: "/contact", label: t("contact") },
  ];
}

/**
 * The site header, for visitors who are not signed in: the landing page, the examples, the legal
 * pages, contact, sign-in and sign-up. Logo to `/`; sections in the center; language, "Sign in"
 * (marked as the current page on the sign-in page) and "Try the demo" (starts the demo) on the right. Below 1024px: the logo and a menu button.
 *
 * `pending`: we do not know yet whether someone is signed in. The header keeps its exact layout but
 * hides its links, so neither the visitor's nor the app's links flash, and nothing moves (CLS 0).
 */
export function SiteHeader({ pending = false }: { pending?: boolean }) {
  const t = useTranslations("Nav");
  const links = useSiteLinks();

  return (
    <HideOnScroll className="bg-paper">
      <div className="wide">
        <div
          className="grid h-[68px] grid-cols-[1fr_auto_1fr] items-center gap-4 md:px-8"
          data-testid="site-header"
        >
          <Link href="/" aria-label={t("home")} className="flex items-center gap-2 justify-self-start">
            <Mark className="size-5" />
            <span className="font-serif text-[1.375rem] leading-none tracking-[-0.01em]">{t("wordmark")}</span>
          </Link>

          <nav
            aria-label={t("sections")}
            aria-hidden={pending || undefined}
            className={cn("hidden items-center gap-7 text-sm font-[450] lg:flex", pending && "invisible")}
          >
            <SiteLinks links={links} />
          </nav>

          <div className="col-start-3 flex items-center gap-2 justify-self-end">
            <LanguagePill className="max-lg:hidden" />
            <div className={cn("contents", pending && "[&>*]:invisible")} aria-hidden={pending || undefined}>
              <SignInLink label={t("signIn")} className="ml-2 mr-1 text-sm font-[450] max-lg:hidden" />
              <TryDemo className="max-lg:hidden" />
              <MobileMenu className="lg:hidden" openLabel={t("openMenu")} closeLabel={t("closeMenu")} items={links}>
                <SignInLink label={t("signIn")} className="text-[1.0625rem]" />
                <TryDemo />
              </MobileMenu>
            </div>
          </div>
        </div>
      </div>
    </HideOnScroll>
  );
}
