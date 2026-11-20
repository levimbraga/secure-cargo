"use client";

import { useId, useState } from "react";

import { Link } from "@/i18n/navigation";

type Item = { href: string; label: string; external?: boolean };

/** Section links for small screens, behind a menu button. */
export function MobileMenu({
  items,
  openLabel,
  closeLabel,
}: {
  items: Item[];
  openLabel: string;
  closeLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? closeLabel : openLabel}
        onClick={() => setOpen((current) => !current)}
        className="flex size-10 items-center justify-center rounded-full hover:bg-surface"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          aria-hidden
        >
          {open ? (
            <path d="M5 5l10 10M15 5L5 15" />
          ) : (
            <path d="M3 7h14M3 13h14" />
          )}
        </svg>
      </button>

      <div
        id={panelId}
        hidden={!open}
        className="absolute inset-x-0 top-16 border-b border-hairline bg-paper"
      >
        <ul className="shell flex flex-col py-2">
          {items.map((item) => {
            const className =
              "flex h-12 items-center border-t border-hairline text-[1.0625rem] first:border-t-0";
            return (
              <li key={item.href} className="contents">
                {item.external ? (
                  <a href={item.href} className={className}>
                    {item.label}
                  </a>
                ) : (
                  <Link
                    href={item.href}
                    className={className}
                    onClick={() => setOpen(false)}
                  >
                    {item.label}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
