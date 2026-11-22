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
import { type Alternative, biggerTrucks, fewerUnits, type RankedOption, rankOptions } from "@/lib/explorer/alternatives";
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
  onResult,
}: {
  draft: LoadDraft | null;
  country: Country;
  /** Put a load in the editor (the fix, or the load before it). */
  onApply: (draft: LoadDraft) => void;
  /** Where the tested load fails, while the editor still shows that load; `null` otherwise. */
  onTrouble: (trouble: Trouble | null) => void;
  /** The whole-trip result while the editor still shows the tested load (the page leads with it); `null` otherwise. */
  onResult?: (battery: Battery | null) => void;
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
  // The ways to make the load pass the planner found, ranked; the one in the editor is `plan`.
  const [options, setOptions] = useState<RankedOption<Plan>[] | null>(null);
  // While the planner tries other trucks and fewer units (after this truck was not enough).
  const [widening, setWidening] = useState(false);
  const optionText = useTranslations("Explorer.options");
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
  useEffect(() => {
    onResult?.(fresh && !busy && shown ? shown : null);
  }, [fresh, busy, shown, onResult]);
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

  /**
   * The planner on this truck first. When it cannot prove a fix there, the same load on bigger
   * trucks and with fewer units goes through the planner too (in parallel), and every way found
   * is offered, ranked. A fix on this truck goes straight into the editor; a change of truck or
   * of the units carried waits for the visitor's choice.
   */
  async function makeSafe() {
    if (!draft) return;
    const original = draft;
    const ranked = await start("plan", async (signal) => {
      const own = await runPlan({ ...draft, country }, signal);
      const mine: RankedOption<Plan> = { kind: "this_truck", plan: own, alternative: null };
      if (own.verified) return [mine];
      setWidening(true);
      const failing = own.battery ? [...troubleOf(own.battery.situations).units.keys()] : [];
      const alternatives = [...biggerTrucks(draft), fewerUnits(draft, failing)].filter((item): item is Alternative => item !== null);
      const plans = await Promise.allSettled(alternatives.map((item) => runPlan({ ...item.draft, country }, signal)));
      const found = alternatives.flatMap((alternative, n): RankedOption<Plan>[] => {
        const answer = plans[n];
        return answer?.status === "fulfilled" ? [{ kind: alternative.kind, plan: answer.value, alternative }] : [];
      });
      return rankOptions([mine, ...found], (candidate) =>
        Boolean(candidate.battery && physicsPassed(candidate.battery) === candidate.battery.situations.length),
      );
    });
    setWidening(false);
    if (!ranked) return;
    setBefore(original);
    setOptions(ranked);
    setSimulation(null);
    const best = ranked[0];
    if (best && best.kind === "this_truck") apply(best.plan);
  }

  function apply(chosen: Plan) {
    setPlan(chosen);
    if (chosen.battery) {
      setBattery(chosen.battery);
      setTested(key(chosen.draft));
    }
    setSimulation(null);
    onApply(chosen.draft);
  }

  function undo() {
    if (!before) return;
    onApply(before);
    setPlan(null);
    setOptions(null);
    setBefore(null);
    setBattery(null);
  }

  const open = (id: SituationId) => {
    setSimulation(id);
    requestAnimationFrame(() => simRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const failing = shown?.situations.filter((situation) => !situation.passed) ?? [];

  return (
    <section id="explorer-trip" className="mt-14 scroll-mt-20 border-t border-hairline pt-8" aria-labelledby="trip-title" data-testid="explorer-trip" data-fresh={fresh} data-state={verdict?.state}>
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
        {fresh && verdict && verdict.state !== "approved" && !plan && !options && (
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
        {before && plan && (
          <button type="button" onClick={undo} disabled={busy !== null} className={pill({ variant: "secondary", className: "h-12 px-5" })} data-testid="trip-undo">
            {t("undo")}
          </button>
        )}
      </div>

      {busy && <Running startedAt={startedAt} label={busy === "battery" ? flow("running.battery") : widening ? t("options.trying") : fixText("finding")} situations={busy === "battery"} />}
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

      {options && !busy && (
        <div className="mt-6" data-testid="trip-options">
          {options.length > 1 && (
            <>
              <h3 className="type-card-title">{t("options.title")}</h3>
              <p className="type-small mt-1 text-pretty text-gray">{t("options.sentence")}</p>
            </>
          )}
          <ol className="mt-4 space-y-4">
            {options.map((option, n) => {
              const applied = plan === option.plan;
              const result = option.plan.battery;
              const holdsAll = Boolean(result && physicsPassed(result) === result.situations.length);
              const state = option.plan.verified ? "approved" : result ? verdictOf(activeBattery(result, country)).state : "fails";
              const alternative = option.alternative;
              const kept = alternative?.draft.units.length ?? 0;
              return (
                <li
                  key={n}
                  className={`rounded-md border p-4 ${applied ? "border-ink" : "border-hairline"}`}
                  data-option={option.kind}
                  data-verified={option.plan.verified}
                  data-testid={applied ? "trip-plan" : undefined}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {n === 0 && options.length > 1 && option.plan.verified && (
                      <span className="inline-flex rounded-full bg-ink px-2.5 py-0.5 text-[0.75rem] font-medium text-paper">{t("options.recommended")}</span>
                    )}
                    <StateBadge state={state} />
                  </div>
                  <h4 className="type-card-title mt-3 text-pretty">
                    {option.kind === "this_truck"
                      ? t("options.thisTruck")
                      : option.kind === "bigger_truck"
                        ? t("options.biggerTruck", { truck: optionText(`size.${alternative?.size ?? "truck"}` as never) })
                        : t("options.fewerUnits", {
                            kept,
                            total: kept + (alternative?.removed?.length ?? 0),
                            units: (alternative?.removed ?? []).map((id) => nameOf(id)).join(", "),
                          })}
                  </h4>
                  <p className={`type-body mt-2 text-pretty ${option.plan.verified ? "text-pass" : "text-ink"}`}>
                    {option.plan.verified
                      ? t(applied ? "applied" : "options.proven")
                      : holdsAll
                        ? t("options.holdsOnly")
                        : t("options.notEnough", { passed: result ? physicsPassed(result) : 0, total: result?.situations.length ?? 7 })}
                  </p>
                  <ChangeList
                    changes={option.plan.changes}
                    before={alternative?.draft ?? before}
                    after={option.plan.draft}
                    title={fixText(applied ? "applied" : "recommended")}
                  />
                  {!applied && option.plan.changes.some((change) => change.code !== "overweight") && (
                    <button
                      type="button"
                      onClick={() => apply(option.plan)}
                      className={pill({ variant: n === 0 ? "primary" : "secondary", className: "mt-4 h-11 px-5" })}
                      data-testid="trip-apply-option"
                    >
                      {t("options.apply")}
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
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
