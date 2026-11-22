import type { Locale } from "@/i18n/routing";

/**
 * Long-form pages (privacy, terms, cookies, methodology, rule sources). Their text lives in
 * `messages/pages/<locale>.json`, apart from the UI messages, so it is rendered on the server and
 * never shipped to the browser with every page's messages.
 */
export type Block = string | { list: string[] } | { table: { head: string[]; rows: string[][] } };

export interface PageSection {
  id: string;
  heading: string;
  body: Block[];
}

export interface PageContent {
  label: string;
  title: string;
  description: string;
  intro: string[];
  sections: PageSection[];
}

export type PageKey = "privacy" | "terms" | "cookies" | "methodology" | "rules";

/** The date shown as "Last updated" on each page (YYYY-MM-DD, Brasília). */
export const PAGE_UPDATED: Record<PageKey, string> = {
  privacy: "2026-11-22",
  terms: "2026-11-22",
  cookies: "2026-11-21",
  methodology: "2026-11-21",
  rules: "2026-11-21",
};

export const LEGAL_PAGES: readonly PageKey[] = ["privacy", "terms", "cookies"];

export async function pageContent(locale: Locale, key: PageKey): Promise<PageContent> {
  const all = (await import(`../messages/pages/${locale}.json`)).default as Record<PageKey, PageContent>;
  return all[key];
}
