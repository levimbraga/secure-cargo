import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SUBJECTS, validateContact } from "@/lib/contact";
import type { PageContent } from "@/lib/page-content";

const read = (path: string) => JSON.parse(readFileSync(join(import.meta.dirname, "..", path), "utf8")) as Record<string, unknown>;
const pages = { en: read("messages/pages/en.json"), "pt-BR": read("messages/pages/pt-BR.json") } as Record<string, Record<string, PageContent>>;
const messages = { en: read("messages/en.json"), "pt-BR": read("messages/pt-BR.json") } as Record<string, Record<string, Record<string, unknown>>>;

function shape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shape);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v)]));
  return typeof value;
}

describe("long-form pages", () => {
  it("have the same structure in English and Portuguese", () => {
    expect(shape(pages["pt-BR"])).toEqual(shape(pages.en));
  });

  it("publish no email address", () => {
    for (const locale of ["en", "pt-BR"]) {
      const text = JSON.stringify(pages[locale]);
      expect(text).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/);
    }
  });

  it("link to the contact form for privacy requests", () => {
    for (const locale of ["en", "pt-BR"]) {
      const rights = pages[locale]?.privacy?.sections.find((s) => s.id === "rights");
      expect(JSON.stringify(rights)).toContain("](/contact)");
    }
  });
});

describe("contact form", () => {
  const valid = { name: "Ana", email: "ana@example.com", subject: "general", message: "Hello, a question about straps." };

  it("accepts a valid message", () => {
    expect(validateContact(valid)).toBeNull();
  });

  it.each([
    [{ name: " " }, "invalid_name"],
    [{ email: "ana@" }, "invalid_email"],
    [{ subject: "" }, "invalid_subject"],
    [{ message: "short" }, "invalid_message"],
    [{ message: "x".repeat(2001) }, "invalid_message"],
    [{ message: "Buy <a href='x'>now</a> please" }, "html_not_allowed"],
  ])("rejects %o", (change, code) => {
    expect(validateContact({ ...valid, ...change })).toBe(code);
  });

  it("offers the same subjects as the Worker, labelled in both languages", () => {
    const worker = readFileSync(join(import.meta.dirname, "..", "..", "backend", "worker", "src", "contact.ts"), "utf8");
    for (const subject of SUBJECTS) {
      expect(worker).toContain(`${subject}: "`);
      for (const locale of ["en", "pt-BR"]) {
        expect((messages[locale]?.Contact?.subjects as Record<string, string>)[subject]).toBeTruthy();
      }
    }
  });
});
