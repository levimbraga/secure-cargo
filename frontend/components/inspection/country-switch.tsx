"use client";

/**
 * 🇧🇷 Brasil / 🇺🇸 United States: whose rules the load is checked against. Independent of the
 * page's language. Switching runs only the rules again: the simulation stays the same.
 */

import { useTranslations } from "next-intl";

import { pill } from "@/components/ui/pill";
import { COUNTRIES, type Country } from "@/lib/country";

export function CountrySwitch({
  country,
  onChange,
  busy = false,
  error = false,
  className = "mb-6",
  hint = true,
}: {
  country: Country;
  onChange: (country: Country) => void;
  busy?: boolean;
  error?: boolean;
  className?: string;
  hint?: boolean;
}) {
  const t = useTranslations("Driver.country");
  return (
    <div className={className} data-testid="country-switch">
      <div className="flex flex-wrap items-center gap-3">
        <span className="type-label">{t("label")}</span>
        <div className="inline-flex rounded-full bg-surface p-1" role="group" aria-label={t("label")}>
          {COUNTRIES.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={country === value}
              disabled={busy}
              onClick={() => value !== country && onChange(value)}
              className={pill({ variant: country === value ? "primary" : "secondary", className: "h-10 px-4" })}
              data-testid={`country-${value}`}
            >
              {t(value)}
            </button>
          ))}
        </div>
      </div>
      <p className="type-small mt-1 text-gray" aria-live="polite">
        {busy ? t("rechecking") : error ? t("unavailable") : hint ? t("hint") : null}
      </p>
    </div>
  );
}
