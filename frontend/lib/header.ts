import type { Me } from "@/lib/app-api";

export type HeaderItem = { href: string; label: string; badge?: number };

/** A manager's pages are the organization's; a platform admin with an organization manages it too. */
export function isManager(me: Me): boolean {
  return Boolean(me.org && (me.org.role === "org_admin" || me.is_platform_admin));
}

/** Where the logo of the app header goes: the user's home. */
export function homeFor(me: Me): string {
  return isManager(me) ? "/app/org" : "/app";
}

/**
 * The app's sections for the signed-in role. Driver: inspections, trucks, explorer. Manager:
 * overview, inspections, alerts (with the open-alerts badge), members, explorer. Platform admin:
 * the same plus Admin. The examples are reached from the explorer and the footer.
 */
export function appItems(me: Me, t: (key: string, values?: Record<string, number>) => string): HeaderItem[] {
  const items: HeaderItem[] = isManager(me)
    ? [
        { href: "/app/org", label: t("overview") },
        { href: "/app/org/inspections", label: t("inspections") },
        { href: "/app/org/alerts", label: t("alerts"), badge: me.org?.alerts ?? 0 },
        { href: "/app/org/team", label: t("members") },
        { href: "/app/explorer", label: t("explorer") },
      ]
    : [
        { href: "/app", label: t("inspections") },
        { href: "/app/trucks", label: t("trucks") },
        { href: "/app/explorer", label: t("explorer") },
      ];
  if (me.is_platform_admin) items.push({ href: "/app/admin", label: t("admin") });
  return items;
}

/** The page is in this section. `/app` and `/app/org` match their own pages, not their children. */
export function isActive(pathname: string, href: string): boolean {
  if (href === "/app") return pathname === "/app" || pathname.startsWith("/app/inspection") || pathname.startsWith("/app/new");
  if (href === "/app/org") return pathname === "/app/org";
  return pathname === href || pathname.startsWith(`${href}/`);
}
