"use client";

import { UserButton } from "@clerk/nextjs";
import { cn } from "cn";
import { useTranslations } from "next-intl";
import { useEffect, useSyncExternalStore } from "react";

import { useMe } from "@/components/app/me-provider";
import { LanguagePill } from "@/components/language-switcher";
import { HideOnScroll } from "@/components/site/hide-on-scroll";
import { Mark } from "@/components/site/mark";
import { type MenuItem, MobileMenu } from "@/components/site/mobile-menu";
import { SiteHeader } from "@/components/site/site-header";
import { pill } from "@/components/ui/pill";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import type { Me } from "@/lib/app-api";
import { appItems, homeFor, isActive } from "@/lib/header";
import { readSessionHint, writeSessionHint } from "@/lib/session-hint";

const noSubscribe = () => () => {};

/** "Demo Insurer · Manager": the organization and the role, so people know where they are. */
function useContextChip(me: Me): string | null {
  const t = useTranslations("AppNav");
  const role = me.org
    ? me.org.role === "org_admin"
      ? t("roleManager")
      : t("roleDriver")
    : me.is_platform_admin
      ? t("roleAdmin")
      : null;
  if (!role) return null;
  return `${me.org?.name ?? t("platform")} · ${role}`;
}

/**
 * The header of every page under /app. Signed in (an account or a demo): the app header. Signed
 * out: the site header. Until we know, the site header's layout with its links hidden, unless this
 * browser was signed in last time (then the app header's frame), so no wrong links flash.
 */
export function AppOrSiteHeader() {
  const { ready, signedIn, me } = useMe();
  // The static HTML cannot know the hint; hydration renders with `null`, then the stored value.
  const hint = useSyncExternalStore(noSubscribe, readSessionHint, () => null);
  useEffect(() => {
    if (ready) writeSessionHint(signedIn);
  }, [ready, signedIn]);

  if (me) return <AppHeader me={me} />;
  if (ready && !signedIn) return <SiteHeader />;
  if (hint === false) return <SiteHeader />;
  if (hint === true) return <AppHeaderFrame />;
  return <SiteHeader pending />;
}

const ROW = "flex h-[68px] items-center justify-between gap-4 md:px-8";
const SHELL = "border-b border-hairline bg-paper";

/** The app header before `/me` answers: the mark and an empty chip, same height. */
function AppHeaderFrame() {
  const nav = useTranslations("Nav");
  return (
    <HideOnScroll className={SHELL}>
      <div className="wide">
        <div className={ROW} data-testid="app-header" data-pending="true">
          <span className="flex items-center gap-3">
            <Mark className="size-5" />
            <span aria-hidden className="h-6 w-32 rounded-full bg-surface" />
          </span>
          <LanguagePill className="max-lg:hidden" />
          <span className="sr-only">{nav("wordmark")}</span>
        </div>
      </div>
    </HideOnScroll>
  );
}

/**
 * The app header: visibly the product (a hairline under it, the mark with the organization and role
 * chip). Logo to the user's home; the role's sections in the center; language and the account menu,
 * or "Demo · Exit", on the right. Below 1024px the sections, language and exit go into the menu,
 * and the chip stays.
 */
export function AppHeader({ me }: { me: Me }) {
  const t = useTranslations("AppNav");
  const nav = useTranslations("Nav");
  const { demo, exitDemo } = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const items = appItems(me, t as never);
  const context = useContextChip(me);

  const exit = async () => {
    await exitDemo();
    router.push("/app/sign-in");
  };
  const exitButton = (className?: string) => (
    // A demo visitor has no account: no profile, password or devices, just a way out.
    <button type="button" onClick={exit} className={pill({ variant: "secondary", className: cn("gap-1.5", className) })} data-testid="demo-exit">
      <span className="type-label text-gray">{t("demoBadge")}</span>
      <span aria-hidden>·</span>
      {t("demoExit")}
    </button>
  );
  const menuItems: MenuItem[] = items.map((item) => ({ ...item, current: isActive(pathname, item.href) }));

  return (
    <HideOnScroll className={SHELL}>
      <div className="wide">
        <div className={ROW} data-testid="app-header">
          <div className="flex min-w-0 items-center gap-3">
            <Link href={homeFor(me)} aria-label={t("homeLabel")} className="flex shrink-0 items-center gap-2">
              <Mark className="size-5" />
              <span className="font-serif text-[1.375rem] leading-none tracking-[-0.01em] max-xl:sr-only">{nav("wordmark")}</span>
            </Link>
            {context && (
              <span
                className="type-label min-w-0 truncate rounded-full bg-surface px-2.5 leading-6 text-ink"
                title={t("context", { context })}
                data-testid="context-chip"
              >
                {context}
              </span>
            )}
          </div>

          <nav aria-label={t("menu")} className="hidden items-center gap-6 text-sm font-[450] lg:flex">
            {items.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn("inline-flex items-center gap-1.5 hover:text-ink", active ? "text-ink" : "text-gray")}
                >
                  {item.label}
                  {item.badge ? (
                    <span
                      className="rounded-full bg-fail-tint px-1.5 font-mono text-[0.75rem] leading-5 text-fail"
                      title={t("alertsBadge", { count: item.badge })}
                      data-testid="alerts-badge"
                    >
                      {item.badge}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            <LanguagePill className="max-lg:hidden" />
            {demo ? (
              exitButton("max-lg:hidden")
            ) : (
              <div className="flex size-8 items-center justify-center">
                <UserButton />
              </div>
            )}
            <MobileMenu className="lg:hidden" openLabel={nav("openMenu")} closeLabel={nav("closeMenu")} items={menuItems}>
              {demo && exitButton()}
            </MobileMenu>
          </div>
        </div>
      </div>
    </HideOnScroll>
  );
}
