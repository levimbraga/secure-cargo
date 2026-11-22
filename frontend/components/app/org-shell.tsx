"use client";

import { cn } from "cn";
import { useTranslations } from "next-intl";
import { useEffect } from "react";

import { CreateOrg } from "@/components/app/create-org";
import { DemoResetNote } from "@/components/app/demo-reset-note";
import { useMe } from "@/components/app/me-provider";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import type { Me } from "@/lib/app-api";

export type OrgTab = "overview" | "alerts" | "inspections" | "team";

const TABS: { id: OrgTab; href: string }[] = [
  { id: "overview", href: "/app/org" },
  { id: "alerts", href: "/app/org/alerts" },
  { id: "inspections", href: "/app/org/inspections" },
  { id: "team", href: "/app/org/team" },
];

type ManagedOrg = NonNullable<Me["org"]>;

/**
 * The manager's pages (desktop-first, usable on a phone): who may see them, the organization's
 * name, and the section tabs. Signed out: to sign-in. No organization: create one. A member: a note.
 * The API enforces all of this again; the page only avoids showing what would be refused.
 */
export function OrgShell({ children }: { children: (org: ManagedOrg) => React.ReactNode }) {
  const t = useTranslations("Manager");
  const create = useTranslations("Manager.create");
  const org = useTranslations("Org");
  const { ready, signedIn, me } = useMe();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (ready && !signedIn) router.replace("/app/sign-in");
  }, [ready, signedIn, router]);

  if (!ready || (signedIn && !me)) return <p className="type-small col text-gray">{t("loading")}</p>;
  if (!signedIn || !me) return null;
  if (!me.org) return <CreateOrg />;
  if (me.org.role !== "org_admin" && !me.is_platform_admin) {
    return <p className="type-body col">{create("member", { org: me.org.name })}</p>;
  }
  const alerts = me.org.alerts ?? 0;
  return (
    <div className="wide md:px-8">
      <p className="type-label">
        {t("label")} · {me.org.type === "insurer" ? org("typeInsurer") : org("typeCarrier")}
      </p>
      <nav aria-label={t("tabs.nav")} className="mt-5 -mx-4 overflow-x-auto px-4 md:mx-0 md:px-0 lg:hidden">
        <ul className="flex min-w-max gap-1 border-b border-hairline">
          {TABS.map((tab) => {
            const active = tab.href === "/app/org" ? pathname === "/app/org" : pathname.startsWith(tab.href);
            return (
              <li key={tab.id}>
                <Link
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "-mb-px flex h-11 items-center gap-2 border-b-2 px-3 text-[0.9375rem]",
                    active ? "border-ink text-ink" : "border-transparent text-gray hover:text-ink",
                  )}
                >
                  {t(`tabs.${tab.id}`)}
                  {tab.id === "alerts" && alerts > 0 && (
                    <span className="rounded-full bg-fail-tint px-1.5 font-mono text-[0.75rem] leading-5 text-fail">{alerts}</span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <DemoResetNote className="mt-3" />
      <div className="mt-10">{children(me.org)}</div>
    </div>
  );
}
