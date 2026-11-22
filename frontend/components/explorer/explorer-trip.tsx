"use client";

/**
 * The whole trip for the explorer's load: the server runs the standard battery of seven
 * situations and the country's rules (`POST /battery`, no login), and the answer reads as in
 * the driver's result: the verdict in three states, the main problem in one sentence, where it
 * fails (which unit, which lashing, in which situation; the top view marks them in red), the
 * checklist and the simulation of any situation.
 *
 * "Make it as safe as possible" asks the planner (`POST /plan`) for the smallest change that
 * passes, proven through the battery, and puts it in the editor; when nothing passes in every
 * situation, the best load it found. "Undo the fix" puts the load back as it was.
 */

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";

import { Checklist, useSituationName } from "@/components/inspection/checklist";
import { ChangeList, ProblemSentence, Running, StateBadge } from "@/components/inspection/result-view";
import { SimulationPanel } from "@/components/inspection/simulation-panel";
import { useReplayText } from "@/components/scenario/replay-shared";
import { pill } from "@/components/ui/pill";
import type { Country } from "@/lib/country";
import type { LoadDraft } from "@/lib/explorer/draft";
import { type Trouble, troubleOf } from "@/lib/explorer/trouble";
import { runBattery, runPlan } from "@/lib/inspection/client";
import { activeBattery, type Battery, type Plan, type SituationId } from "@/lib/inspection/types";
import { physicsPassed, verdictOf } from "@/lib/inspection/verdict";

type Busy = "battery" | "plan" | null;

function key(draft: LoadDraft | null): string {
  return draft ? JSON.stringify(draft) : "";
}

export function ExplorerTrip({
  draft,
  country,
  onApply,
  onTrouble,
}: {
  draft: LoadDraft | null;
  country: Country;
  /** Put a load in the editor (the fix, or the load before it). */
  onApply: (draft: LoadDraft) => void;
  /** Where the tested load fails, while the editor still shows that load; `null` otherwise. */
  onTrouble: (trouble: Trouble | null) => void;
}) {
  const t = useTranslations("Explorer.trip");
  const verdictText = useTranslations("Driver.verdict");
  const fixText = useTranslations("Driver.fix");
  const flow = useTranslations("Flow");
  const { nameOf } = useReplayText();
  const situationName = useSituationName();
  const [battery, setBattery] = useState<Battery | null>(null);
  const [tested, setTested] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [before, setBefore] = useState<LoadDraft | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [simulation, setSimulation] = useState<SituationId | null>(null);
  const abort = useRef<AbortController | null>(null);
  const simRef = useRef<HTMLDivElement>(null);

  const fresh = Boolean(battery && draft && tested === key(draft));
  const shown = useMemo(() => (battery ? activeBattery(battery, country) : null), [battery, country]);
  const verdict = shown ? verdictOf(shown) : null;
  const trouble = useMemo(() => (shown ? troubleOf(shown.situations) : null), [shown]);

  useEffect(() => {
    onTrouble(fresh && trouble ? trouble : null);
  }, [fresh, trouble, onTrouble]);
  useEffect(() => () => abort.current?.abort(), []);

  async function start<T>(kind: Exclude<Busy, null>, call: (signal: AbortSignal) => Promise<T>): Promise<T | null> {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setBusy(kind);
    setStartedAt(Date.now());
    setError(null);
    try {
      return await call(controller.signal);
    } catch (cause) {
      if (!controller.signal.aborted) setError((cause as { code?: string })?.code ?? "failed");
      return null;
    } finally {
      if (!controller.signal.aborted) setBusy(null);
    }
  }

  async function test() {
    if (!draft) return;
    const sent = { ...draft, country };
    const result = await start("battery", (signal) => runBattery(sent, signal));
    if (!result) return;
    setBattery(result);
    setTested(key(draft));
    setPlan(null);
    setBefore(null);
    setSimulation(null);
  }

  async function makeSafe() {
    if (!draft) return;
    const original = draft;
    const result = await start("plan", (signal) => runPlan({ ...draft, country }, signal));
    if (!result) return;
    setPlan(result);
    setBefore(original);
    if (result.battery) {
      setBattery(result.battery);
      setTested(key(result.draft));
    }
    setSimulation(null);
    onApply(result.draft);
  }

  function undo() {
    if (!before) return;
    onApply(before);
    setPlan(null);
    setBefore(null);
    setBattery(null);
  }

  const open = (id: SituationId) => {
    setSimulation(id);
    requestAnimationFrame(() => simRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const failing = shown?.situations.filter((situation) => !situation.passed) ?? [];
  const proven = Boolean(plan?.verified);

  return (
    <section className="mt-14 border-t border-hairline pt-8" aria-labelledby="trip-title" data-testid="explorer-trip" data-fresh={fresh} data-state={verdict?.state}>
      <h2 id="trip-title" className="type-card-title">
        {t("title")}
      </h2>
      <p className="type-body mt-2 max-w-prose text-pretty">{t("sentence")}</p>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={() => void test()}
          disabled={!draft || busy !== null}
          className={pill({ variant: fresh ? "secondary" : "primary", className: "h-12 px-5" })}
          data-testid="trip-test"
        >
          {battery && !fresh ? t("retest") : t("test")}
        </button>
        {fresh && verdict && verdict.state !== "approved" && !plan && (
          <button
            type="button"
            onClick={() => void makeSafe()}
            disabled={busy !== null}
            className={pill({ className: "h-12 px-5" })}
            data-testid="trip-make-safe"
          >
            {t("makeSafe")}
          </button>
        )}
        {before && (
          <button type="button" onClick={undo} disabled={busy !== null} className={pill({ variant: "secondary", className: "h-12 px-5" })} data-testid="trip-undo">
            {t("undo")}
          </button>
        )}
      </div>

      {busy && <Running startedAt={startedAt} label={busy === "battery" ? flow("running.battery") : fixText("finding")} situations={busy === "battery"} />}
      {error && !busy && (
        <p role="alert" className="type-small mt-3 text-fail">
          {flow.has(`errors.${error}` as never) ? flow(`errors.${error}` as never) : flow("errors.failed")}
        </p>
      )}

      {battery && !fresh && !busy && (
        <p className="type-small mt-4 text-gray" data-testid="trip-stale">
          {t("stale")}
        </p>
      )}

      {plan && !busy && (
        <div className="mt-6" data-testid="trip-plan" data-verified={proven}>
          <p className={`type-body ${proven ? "text-pass" : "text-ink"}`}>
            {plan.changes.length === 0
              ? fixText("none")
              : proven
                ? t("applied")
                : plan.battery && verdictOf(plan.battery).state === "holds_noncompliant"
                  ? t("bestHolds")
                  : t("best", { passed: plan.battery ? physicsPassed(plan.battery) : 0, total: plan.battery?.situations.length ?? 7 })}
          </p>
          <ChangeList changes={plan.changes} before={before} after={plan.draft} title={fixText("applied")} />
        </div>
      )}

      {shown && verdict && fresh && !busy && (
        <div className="mt-8" data-testid="trip-result" data-state={verdict.state}>
          <StateBadge state={verdict.state} />
          <h3 className="type-card-title mt-3 text-pretty" data-testid="trip-verdict">
            {verdictText(`${verdict.state}.title`)}
          </h3>
          {verdict.problem && (
            <p className="type-body mt-2 text-pretty">
              <ProblemSentence problem={verdict.problem} battery={shown} />
            </p>
          )}
          <p className="type-small mt-2 text-gray">{verdictText("count", { passed: physicsPassed(shown), total: shown.situations.length })}</p>

          {failing.length > 0 && trouble && (
            <div className="mt-6">
              <h4 className="type-label">{t("where")}</h4>
              <ul className="mt-2 space-y-2" data-testid="trip-where">
                {failing.map((situation) => {
                  const units = [...trouble.units].flatMap(([id, bySituation]) => {
                    const code = bySituation.get(situation.id);
                    return code ? [[id, code] as const] : [];
                  });
                  const lashings = [...trouble.lashings].filter(([, list]) => list.includes(situation.id));
                  return (
                    <li key={situation.id} className="text-sm text-ink" data-situation={situation.id}>
                      <button
                        type="button"
                        onClick={() => open(situation.id)}
                        className="text-left underline decoration-hairline underline-offset-4 hover:decoration-ink"
                      >
                        {situationName(situation.id, situation.event.speed_kmh)}
                      </button>
                      <span className="text-gray">
                        {" · "}
                        {units.length
                          ? units.map(([id, code]) => t(`failure.${code}` as never, { unit: nameOf(id) } as never)).join("; ")
                          : t("failure.load")}
                        {lashings.length > 0 && ` · ${t("lashings", { count: lashings.length })}`}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="type-small mt-2 text-gray">{t("marked")}</p>
            </div>
          )}

          <div ref={simRef} className="scroll-mt-4">
            {simulation && <SimulationPanel key={simulation} battery={shown} situation={simulation} onClose={() => setSimulation(null)} />}
          </div>
          <Checklist battery={shown} onOpenSituation={open} readOnly />
        </div>
      )}
    </section>
  );
}
