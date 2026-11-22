"use client";

/**
 * The rules of the explorer's load, checked on paper (`POST /battery/checks`: no simulation, no
 * AI) every time the visitor pauses an edit. The live run is one situation and says only whether
 * the load moves in it; the rules can already fail (a rope, a missing diagonal, an axle over its
 * limit), so the top of the page never says "holds" without saying so too.
 *
 * Without the API (the static demo cache) the rules are simply unknown: `null`.
 */

import { useEffect, useState } from "react";

import type { Country } from "@/lib/country";
import { checkRules } from "@/lib/inspection/client";
import type { Battery } from "@/lib/inspection/types";
import { type MainProblem, verdictOf } from "@/lib/inspection/verdict";

import type { LoadDraft } from "./draft";

const DEBOUNCE_MS = 600;

export type RuleCheck = {
  /** The draft the answer is for, as JSON. */
  key: string;
  /** The first rule that fails under the country's rules, or `null` when none does. */
  problem: MainProblem | null;
  /** How many rules fail. */
  failing: number;
};

/** The rule failures of one country's rule set (securing checks and the checklist's rule items). */
export function ruleFailures(rules: NonNullable<Battery["rules"]>, country: Country): { problem: MainProblem | null; failing: number } {
  const set = rules[country];
  if (!set) return { problem: null, failing: 0 };
  const items = [set.checklist?.weight, set.checklist?.dimensions, set.checklist?.protection].flatMap((list) => list ?? []);
  const failing =
    set.securing.filter((check) => check.status === "fail").length +
    items.filter((item) => item.kind === "rule" && item.status === "fail").length;
  const { problem } = verdictOf({ situations: [], contran_945: set.securing, checklist: set.checklist, country, rules });
  return { problem, failing };
}

export function useRuleCheck(draft: LoadDraft | null, country: Country): RuleCheck | null {
  const [rules, setRules] = useState<{ key: string; rules: NonNullable<Battery["rules"]> } | null>(null);
  const key = draft ? JSON.stringify(draft) : "";

  useEffect(() => {
    if (!draft) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      checkRules(draft, controller.signal)
        .then((answer) => {
          if (answer && !controller.signal.aborted) setRules({ key, rules: answer });
        })
        .catch(() => {
          // The API is down or busy: the rules stay unknown, nothing is claimed.
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // `key` is the draft's content: a new object with the same load asks nothing new.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!rules || rules.key !== key) return null;
  return { key, ...ruleFailures(rules.rules, country) };
}
