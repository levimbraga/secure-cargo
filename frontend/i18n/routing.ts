import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["en", "pt-BR"],
  defaultLocale: "en",
  // English lives at `/`, Brazilian Portuguese at `/pt-BR`.
  localePrefix: "as-needed",
  // The URL is the only source of truth: English by default, pt-BR via the switcher.
  localeDetection: false,
  localeCookie: false,
});

export type Locale = (typeof routing.locales)[number];
