"use client";

import { UserButton } from "@clerk/nextjs";
import { cn } from "cn";
import { useTranslations } from "next-intl";

import { useMe } from "@/components/app/me-provider";
import { MobileMenu } from "@/components/site/mobile-menu";
import { pill } from "@/components/ui/pill";
import { Link, usePathname } from "@/i18n/navigation";

type Item = { href: string; label: string };

/** The app's sections for the signed-in role. Gallery, explorer and lab are there for everyone. */
function useItems(): Item[] {
  const t = useTranslations("AppNav");
  const { me } = useMe();
  const items: Item[] = [{ href: "/app", label: t("inspections") }];
  if (me?.org?.role === "org_admin" || (me?.is_platform_admin && me.org)) items.push({ href: "/app/org", label: t("org") });
  if (me?.is_platform_admin) items.push({ href: "/app/admin", label: t("admin") });
  items.push(
    { href: "/app/examples", label: t("examples") },
    { href: "/app/explorer", label: t("explorer") },
  );
  return items;
}

function isActive(pathname: string, href: string): boolean {
  return href === "/app" ? pathname === "/app" || pathname.startsWith("/app/inspections") : pathname.startsWith(href);
}

/** Section links in the center of the nav, from 768px up. */
export function AppLinks() {
  const items = useItems();
  const pathname = usePathname();
  return (
    <>
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={isActive(pathname, item.href) ? "page" : undefined}
          className={cn("hover:text-ink", isActive(pathname, item.href) ? "text-ink" : "text-gray")}
        >
          {item.label}
        </Link>
      ))}
    </>
  );
}

/** Right side of the nav: the user's menu (or "Sign in") and, on phones, the sections menu. */
export function AppUser() {
  const t = useTranslations("AppNav");
  const nav = useTranslations("Nav");
  const member = useTranslations("Member");
  const items = useItems();
  const { signedIn, me } = useMe();

  return (
    <>
      {me?.user.is_demo && (
        <span className="type-label rounded-full bg-surface px-2.5 py-1 max-md:hidden">{t("demoBadge")}</span>
      )}
      {signedIn ? (
        <div className="flex size-8 items-center justify-center">
          <UserButton />
        </div>
      ) : (
        <Link href="/app/sign-in" className={pill({ className: "max-md:hidden" })}>
          {t("signIn")}
        </Link>
      )}
      <MobileMenu
        openLabel={nav("openMenu")}
        closeLabel={nav("closeMenu")}
        items={items}
        cta={signedIn ? { href: "/app/inspections/new", label: member("newInspection") } : { href: "/app/sign-in", label: t("signIn") }}
      />
    </>
  );
}
