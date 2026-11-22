"use client";

import { UserButton } from "@clerk/nextjs";
import { cn } from "cn";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";

import { useMe } from "@/components/app/me-provider";
import { LanguagePill } from "@/components/language-switcher";
import { HideOnScroll } from "@/components/site/hide-on-scroll";
import { Mark } from "@/components/site/mark";
import { type MenuItem, MobileMenu } from "@/components/site/mobile-menu";
import { SiteHeader } from "@/components/site/site-header";
import { pill } from "@/components/ui/pill";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import type { Me } from "@/lib/app-api";
import { type DemoRole, demoRoleOf } from "@/lib/demo-session";
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

const CHIP = "type-label min-w-0 truncate rounded-full bg-surface px-2.5 leading-6 text-ink";
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
            {context &&
              (demo ? (
                <DemoChip me={me} context={context} />
              ) : (
                <span className={CHIP} title={t("context", { context })} data-testid="context-chip">
                  {context}
                </span>
              ))}
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

/**
 * The demo's context chip, with one action: switch between the driver and the insurer view. The
 * Worker keeps the sandbox, so what the visitor made as a driver shows up in the insurer's
 * dashboard; no sign-out in between.
 */
function DemoChip({ me, context }: { me: Me; context: string }) {
  const t = useTranslations("AppNav");
  const { enterDemo } = useMe();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const other: DemoRole = demoRoleOf(me) === "driver" ? "insurer" : "driver";

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    const onDown = (event: PointerEvent) => !ref.current?.contains(event.target as Node) && setOpen(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  async function switchRole() {
    setBusy(true);
    setFailed(false);
    try {
      await enterDemo(other);
      setOpen(false);
      router.push(other === "insurer" ? "/app/org" : "/app");
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`${context}. ${t("demoMenu")}`}
        onClick={() => setOpen((value) => !value)}
        className={cn(CHIP, "flex max-w-full items-center gap-1 hover:bg-hairline")}
        data-testid="context-chip"
      >
        <span className="truncate">{context}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className={cn("shrink-0 transition-transform", open && "rotate-180")}>
          <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      </button>
      <div
        id={menuId}
        hidden={!open}
        className="absolute left-0 top-full z-50 mt-2 w-max min-w-full rounded border border-hairline bg-paper p-1"
      >
        <button
          type="button"
          onClick={switchRole}
          disabled={busy}
          className="flex h-10 w-full items-center gap-2 rounded px-3 text-left text-sm font-[450] hover:bg-surface disabled:opacity-60"
          data-testid="demo-switch"
        >
          {busy && <span aria-hidden className="inline-block size-3 animate-spin rounded-full border-[1.5px] border-current border-r-transparent" />}
          {busy ? t("switching") : other === "insurer" ? t("switchToInsurer") : t("switchToDriver")}
        </button>
        {failed && (
          <p role="alert" className="type-small max-w-56 px-3 pb-2 text-fail">
            {t("switchFailed")}
          </p>
        )}
      </div>
    </div>
  );
}
