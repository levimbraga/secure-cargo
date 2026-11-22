"use client";

import { cn } from "cn";
import { useEffect, useId, useState } from "react";

import { LanguageLinks } from "@/components/language-switcher";
import { pill } from "@/components/ui/pill";
import { Link, usePathname } from "@/i18n/navigation";

export type MenuItem = { href: string; label: string; external?: boolean; badge?: number; current?: boolean };

/**
 * Section links, language and the actions for small screens, behind a menu button. `className`
 * sets the breakpoint from which the menu button goes away (the header shows its links instead).
 * The panel closes on a link, on Escape and when the page changes.
 */
export function MobileMenu({
  items,
  cta,
  secondary,
  children,
  openLabel,
  closeLabel,
  className = "md:hidden",
}: {
  items: MenuItem[];
  cta?: MenuItem;
  /** A plain text link above the primary action ("Sign in"). */
  secondary?: MenuItem;
  /** Extra actions at the bottom of the panel (for example "Demo · Exit"). */
  children?: React.ReactNode;
  openLabel: string;
  closeLabel: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const pathname = usePathname();
  const row = "flex h-11 items-center gap-2 text-[1.0625rem]";
  const close = () => setOpen(false);

  // A new page closes the menu (links inside it close it too; this covers back and forward).
  const [shownFor, setShownFor] = useState(pathname);
  if (shownFor !== pathname) {
    setShownFor(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? closeLabel : openLabel}
        onClick={() => setOpen((current) => !current)}
        className="-mr-2 flex size-10 items-center justify-center rounded-full"
        data-testid="menu-button"
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 22 22"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          aria-hidden
        >
          {open ? <path d="M5 5l12 12M17 5L5 17" /> : <path d="M2 5.5h18M2 11h18M2 16.5h18" />}
        </svg>
      </button>

      <div id={panelId} hidden={!open} className="absolute inset-x-0 top-full border-b border-hairline bg-paper pb-6">
        <div className="wide">
          <ul>
            {items.map((item) => (
              <li key={item.href}>
                {item.external ? (
                  <a href={item.href} className={row}>
                    {item.label}
                  </a>
                ) : (
                  <Link
                    href={item.href}
                    aria-current={item.current ? "page" : undefined}
                    className={cn(row, item.current === false && "text-gray")}
                    onClick={close}
                  >
                    {item.label}
                    {item.badge ? (
                      <span className="rounded-full bg-fail-tint px-1.5 font-mono text-[0.75rem] leading-5 text-fail">
                        {item.badge}
                      </span>
                    ) : null}
                  </Link>
                )}
              </li>
            ))}
          </ul>
          <LanguageLinks className="mt-2 flex gap-5" linkClassName={`${row} text-gray`} />
          {(secondary || cta || children) && (
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
              {secondary && (
                <Link href={secondary.href} className="text-[1.0625rem]" onClick={close}>
                  {secondary.label}
                </Link>
              )}
              {cta && (
                <Link href={cta.href} className={pill()} onClick={close}>
                  {cta.label}
                </Link>
              )}
              {children}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
