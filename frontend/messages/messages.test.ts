import { describe, expect, it } from "vitest";

import { routing } from "../i18n/routing";
import en from "./en.json";
import ptBR from "./pt-BR.json";

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Record<string, string> {
  return Object.entries(tree).reduce<Record<string, string>>(
    (acc, [key, value]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return typeof value === "string"
        ? { ...acc, [path]: value }
        : { ...acc, ...flatten(value, path) };
    },
    {},
  );
}

const catalogs: Record<string, Record<string, string>> = {
  en: flatten(en),
  "pt-BR": flatten(ptBR),
};

describe("translation catalogs", () => {
  it("exist for every configured locale", () => {
    expect(Object.keys(catalogs).sort()).toEqual([...routing.locales].sort());
    expect(routing.defaultLocale).toBe("en");
  });

  it("define exactly the same keys in every locale", () => {
    const reference = Object.keys(catalogs.en ?? {}).sort();
    for (const [locale, catalog] of Object.entries(catalogs)) {
      expect(Object.keys(catalog).sort(), locale).toEqual(reference);
    }
  });

  it("have no empty strings", () => {
    for (const [locale, catalog] of Object.entries(catalogs)) {
      for (const [key, value] of Object.entries(catalog)) {
        expect(value.trim(), `${locale}: ${key}`).not.toBe("");
      }
    }
  });

  it("show the product tagline on the English landing page", () => {
    expect(en.Landing.title).toBe(
      "SecureCargo — Physics-tested cargo securement",
    );
  });
});
