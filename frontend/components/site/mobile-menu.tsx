"use client";

import { useId, useState } from "react";

import { LanguageLinks } from "@/components/language-switcher";
import { pill } from "@/components/ui/pill";
import { Link } from "@/i18n/navigation";

type Item = { href: string; label: string; external?: boolean };

/** Section links, language and the primary action for small screens, behind a menu button. */
export function MobileMenu({
  items,
  cta,
  openLabel,
  closeLabel,
}: {
  items: Item[];
  cta: Item;
  openLabel: string;
  closeLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const row = "flex h-11 items-center text-[1.0625rem]";

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? closeLabel : openLabel}
        onClick={() => setOpen((current) => !current)}
        className="-mr-2 flex size-10 items-center justify-center rounded-full"
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

      <div id={panelId} hidden={!open} className="absolute inset-x-0 top-[68px] bg-paper pb-6">
        <div className="wide">
          <ul>
            {items.map((item) => (
              <li key={item.href}>
                {item.external ? (
                  <a href={item.href} className={row}>
                    {item.label}
                  </a>
                ) : (
                  <Link href={item.href} className={row} onClick={() => setOpen(false)}>
                    {item.label}
                  </Link>
                )}
              </li>
            ))}
          </ul>
          <LanguageLinks className="mt-2 flex gap-5" linkClassName={`${row} text-gray`} />
          <Link href={cta.href} className={pill({ className: "mt-4" })}>
            {cta.label}
          </Link>
        </div>
      </div>
    </div>
  );
}
