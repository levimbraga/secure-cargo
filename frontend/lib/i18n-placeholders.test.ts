/**
 * No raw "{placeholder}" reaches the page: every message with an argument ("Bed length ({unit})")
 * must be called with its values. next-intl renders a message called without them with the
 * braces left in, in English and in Portuguese alike. This test reads every component and finds
 * the calls of a translator (`const t = useTranslations("Ns")`) with a literal key and no
 * values; the browser test `e2e/placeholders.spec.ts` checks the rendered text of the pages.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import en from "../messages/en.json";
import ptBR from "../messages/pt-BR.json";

const ROOT = join(__dirname, "..");
const DIRS = ["app", "components", "lib"];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

function lookup(messages: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined), messages);
}

/** The ICU arguments of a message: "{unit}" and "{count, plural, …}" (not the plural's "#"). */
export function argumentsOf(message: string): string[] {
  return [...message.matchAll(/\{\s*([A-Za-z_]\w*)\s*[,}]/g)].map((match) => match[1] ?? "");
}

/** Calls with a literal key and nothing else, for each translator bound in a file. */
export function bareCalls(source: string): { namespace: string; key: string }[] {
  const translators = new Map<string, string>();
  for (const match of source.matchAll(/const (\w+) = (?:await )?(?:use|get)Translations\(\s*(?:"([\w.]+)"|\{[^}]*namespace:\s*"([\w.]+)"[^}]*\})?\s*\)/g)) {
    translators.set(match[1] ?? "", match[2] ?? match[3] ?? "");
  }
  const calls: { namespace: string; key: string }[] = [];
  for (const [name, namespace] of translators) {
    for (const match of source.matchAll(new RegExp(`(?<![\\w.])${name}\\(\\s*"([\\w.-]+)"\\s*\\)`, "g"))) {
      calls.push({ namespace, key: match[1] ?? "" });
    }
  }
  return calls;
}

describe("messages with arguments are always called with values", () => {
  it("finds the arguments of a message", () => {
    expect(argumentsOf("Bed length ({unit})")).toEqual(["unit"]);
    expect(argumentsOf("{count, plural, one {# axle} other {# axles}}")).toEqual(["count"]);
    expect(argumentsOf("Plain text.")).toEqual([]);
  });

  it("finds a bare call", () => {
    const source = 'const t = useTranslations("Driver.trucks");\nlabel(t("bedLength"));\nt("save", { a: 1 });';
    expect(bareCalls(source)).toEqual([{ namespace: "Driver.trucks", key: "bedLength" }]);
  });

  for (const [language, messages] of [
    ["en", en],
    ["pt-BR", ptBR],
  ] as const) {
    it(`no component leaves a {placeholder} in ${language}`, () => {
      const missing: string[] = [];
      for (const dir of DIRS) {
        for (const path of files(join(ROOT, dir))) {
          for (const { namespace, key } of bareCalls(readFileSync(path, "utf8"))) {
            const full = namespace ? `${namespace}.${key}` : key;
            const message = lookup(messages, full);
            if (typeof message === "string" && argumentsOf(message).length > 0) {
              missing.push(`${relative(ROOT, path)}: ${full} = ${JSON.stringify(message)}`);
            }
          }
        }
      }
      expect(missing).toEqual([]);
    });
  }
});
