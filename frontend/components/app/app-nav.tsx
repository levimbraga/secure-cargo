"use client";

import { UserButton } from "@clerk/nextjs";
import { cn } from "cn";
import { useTranslations } from "next-intl";

import { useMe } from "@/components/app/me-provider";
import { MobileMenu } from "@/components/site/mobile-menu";
import { pill } from "@/components/ui/pill";
import { Link, usePathname, useRouter } from "@/i18n/navigation";

type Item = { href: string; label: string; badge?: number };

/** The app's sections for the signed-in role. Gallery, explorer and lab are there for everyone. */
function useItems(): Item[] {
  const t = useTranslations("AppNav");
  const { me } = useMe();
  const items: Item[] = [{ href: "/app", label: t("inspections") }];
  if (me) items.push({ href: "/app/trucks", label: t("trucks") });
  if (me?.org?.role === "org_admin" || (me?.is_platform_admin && me.org)) {
    const alerts = me.org.alerts ?? 0;
    // The badge: loads that failed and have no proven fix after the organization's N hours.
    items.push({ href: "/app/org", label: alerts > 0 ? `${t("org")} · ${t("alertsBadge", { count: alerts })}` : t("org"), badge: alerts });
  } else if (me && !me.org && !me.user.is_demo) {
    items.push({ href: "/app/org", label: t("org") });
  }
  if (me?.is_platform_admin) items.push({ href: "/app/admin", label: t("admin") });
  items.push(
    { href: "/app/examples", label: t("examples") },
    { href: "/app/explorer", label: t("explorer") },
  );
  return items;
}

function isActive(pathname: string, href: string): boolean {
  return href === "/app" ? pathname === "/app" || pathname.startsWith("/app/inspection") : pathname.startsWith(href);
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
          className={cn("inline-flex items-center gap-1.5 hover:text-ink", isActive(pathname, item.href) ? "text-ink" : "text-gray")}
        >
          {item.badge ? item.label.split(" · ")[0] : item.label}
          {item.badge ? (
            <span className="rounded-full bg-fail-tint px-1.5 font-mono text-[0.75rem] leading-5 text-fail" title={item.label} data-testid="alerts-badge">
              {item.badge}
            </span>
          ) : null}
        </Link>
      ))}
    </>
  );
}

/** Right side of the nav: the user's menu (or "Sign in"), or "Demo · Exit"; on phones, the sections menu. */
export function AppUser() {
  const t = useTranslations("AppNav");
  const nav = useTranslations("Nav");
  const member = useTranslations("Member");
  const items = useItems();
  const { signedIn, demo, exitDemo } = useMe();
  const router = useRouter();

  return (
    <>
      {demo ? (
        // A demo visitor has no account: no profile, password or devices, just a way out.
        <button
          type="button"
          onClick={async () => {
            await exitDemo();
            router.push("/app/sign-in");
          }}
          className={pill({ variant: "secondary", className: "gap-1.5" })}
          data-testid="demo-exit"
        >
          <span className="type-label text-gray">{t("demoBadge")}</span>
          <span aria-hidden>·</span>
          {t("demoExit")}
        </button>
      ) : signedIn ? (
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
        cta={signedIn ? { href: "/app/new", label: member("newInspection") } : { href: "/app/sign-in", label: t("signIn") }}
      />
    </>
  );
}
