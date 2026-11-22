"use client";

/**
 * The result of an inspection, the driver's way:
 *
 * 1. the verdict in three states (approved / holds but out of compliance / does not arrive
 *    intact) with one sentence naming the main problem, and "Open the simulation";
 * 2. a one-line summary of what was read (truck, axles, units, restraints, position), the
 *    low-confidence items flagged, and "Wrong reading? Correct it";
 * 3. the checklist by theme;
 * 4. "How to make it safe": the minimal set of changes, "Simulate with the fix" and "I fixed it:
 *    take a new photo";
 * 5. sharing.
 *
 * Used by the new-inspection flow and, read only, by a saved inspection's page.
 */

import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { useReplayText } from "@/components/scenario/replay-shared";
import { pill } from "@/components/ui/pill";
import { VerdictBadge } from "@/components/ui/verdict-badge";
import { UnitsProvider, useShownUnits } from "@/components/units-context";
import { type Country, useCountry } from "@/lib/country";
import { footprints } from "@/lib/explorer/draft";
import { cutOffUnits } from "@/lib/inspection/photo-quality";
import { SIZE_INFO, type TruckChoice } from "@/lib/inspection/trucks";
import {
  activeBattery,
  type Battery,
  type Change,
  hasRules,
  type PhotoAnalysis,
  type Plan,
  SITUATION_IDS,
  type SituationId,
  type UnitLink,
} from "@/lib/inspection/types";
import { physicsPassed, verdictOf, type MainProblem, type VerdictState } from "@/lib/inspection/verdict";
import type { WeightRange, WeightSource } from "@/lib/inspection/weight";

import { Checklist, SITUATION_SPEED_KMH, useSituationName } from "./checklist";
import { CountrySwitch } from "./country-switch";
import { SimulationPanel } from "./simulation-panel";
import { TruckArt } from "./truck-art";

type Variant = "as_loaded" | "fixed";

export const STATE_BADGE: Record<VerdictState, "pass" | "warn" | "fail"> = {
  approved: "pass",
  holds_noncompliant: "warn",
  fails: "fail",
};

export function useMainProblem() {
  const t = useTranslations("Driver.problem");
  const { nameOf } = useReplayText();
  const units = useShownUnits();
  const unitName = (id: string | null) => (id ? lower(nameOf(id)) : t("theLoad"));
  return (problem: MainProblem | null): string | null => {
    if (!problem) return null;
    if (problem.kind === "physics") {
      const speed = units.speed(SITUATION_SPEED_KMH[problem.situation as SituationId] ?? 80);
      const when = t(`when.${problem.situation}` as never, { speed } as never);
      return t(`physics.${problem.code}` as never, { when, unit: unitName(problem.unitId) } as never);
    }
    const axle = problem.code === "axle" || problem.code === "us_axle" || problem.code === "eu_axle" ? t(`axleName.${problem.unitId ?? "rear"}` as never) : "";
    const sentence = t(`rule.${problem.code}` as never, { unit: unitName(problem.unitId), axle } as never);
    // "{unit} needs…" starts with a unit's name, written in lower case mid-sentence.
    return sentence.charAt(0).toLocaleUpperCase() + sentence.slice(1);
  };
}

const DEFICIENCY_RANK = { minor: 1, major: 2, dangerous: 3 } as const;

/**
 * EU mode: how a roadside inspection would class the load (Directive 2014/47/EU Annex III II.1:
 * the highest class of its deficiencies), or that it would find none in the securing.
 */
export function RoadsideClass({ checks }: { checks: Battery["contran_945"] }) {
  const t = useTranslations("Driver.roadside");
  let worst: keyof typeof DEFICIENCY_RANK | null = null;
  for (const check of checks) {
    const deficiency = check.status === "fail" && "deficiency" in check ? check.deficiency : null;
    if (deficiency && (!worst || DEFICIENCY_RANK[deficiency] > DEFICIENCY_RANK[worst])) worst = deficiency;
  }
  const tone = worst === "dangerous" ? "bg-fail text-white" : worst === "major" ? "bg-warn-tint text-warn ring-1 ring-warn" : worst ? "bg-surface text-ink" : "bg-pass-tint text-pass";
  return (
    <p className="mt-3 flex flex-wrap items-center gap-2" data-testid="roadside-class" data-class={worst ?? "none"}>
      <span className={`inline-flex rounded-full px-3 py-1 text-[0.8125rem] font-medium ${tone}`}>{t(worst ?? "none")}</span>
      <span className="type-small text-gray">{t(worst ? `${worst}Meaning` : "noneMeaning")}</span>
    </p>
  );
}

/** The verdict badge as lists and dashboards show it. */
export function StateBadge({ state, children }: { state: VerdictState; children?: ReactNode }) {
  const t = useTranslations("Driver.verdict");
  return <VerdictBadge verdict={STATE_BADGE[state]}>{children ?? t(`${state}.badge`)}</VerdictBadge>;
}

export function ResultView({
  battery,
  plan,
  fixing = false,
  fixStartedAt = null,
  onApplyFix,
  sampleRuns,
  readOnly = false,
  error = null,
  truck = null,
  weightSource = null,
  range = null,
  illustrativeKg = null,
  analysis = null,
  links = [],
  onCorrect,
  onReinspect,
  onHeadboard,
  onFrontEndRating,
  truckAssumed = false,
  share,
  before = null,
  provenBy = null,
  country: initialCountry = null,
  onCountryChange,
  fetchRules,
}: {
  battery: Battery;
  plan: Plan | null;
  fixing?: boolean;
  fixStartedAt?: number | null;
  onApplyFix?: () => void;
  /** Static runs of a sample's situations (no API needed). */
  sampleRuns?: Partial<Record<Variant, Partial<Record<SituationId, string>>>>;
  readOnly?: boolean;
  error?: string | null;
  truck?: TruckChoice | null;
  weightSource?: WeightSource | null;
  range?: WeightRange | null;
  /** A sample's made-up invoice weight [kg]: shown as illustrative, never as read from the photo. */
  illustrativeKg?: number | null;
  analysis?: PhotoAnalysis | null;
  links?: UnitLink[];
  onCorrect?: () => void;
  onReinspect?: () => void;
  onHeadboard?: (heightM: number) => void;
  /** US: re-check with the front end structure's declared rating (kg of force). */
  onFrontEndRating?: (kg: number) => void;
  /** A sample whose photo does not show the truck's size: the summary says it is assumed. */
  truckAssumed?: boolean;
  share?: ReactNode;
  /** A re-inspection: the first inspection's battery, for the before / after. */
  before?: Battery | null;
  /** The re-inspection that proved this inspection's fix. */
  provenBy?: ReactNode;
  /** Whose rules to show first: the inspection's (saved), else the visitor's choice. */
  country?: Country | null;
  /** The visitor switched country (a saved inspection's author: store it). */
  onCountryChange?: (country: Country) => void;
  /** Both countries' rules of a load, without simulating it, for a battery stored without them. */
  fetchRules?: (draft: Battery["draft"]) => Promise<Battery["rules"]>;
}) {
  const t = useTranslations("Driver");
  const [preferred, choose] = useCountry();
  const [chosen, setCountry] = useState<Country | null>(null);
  const country = chosen ?? initialCountry ?? preferred;
  // Rule sets fetched for batteries stored before US mode (no simulation, no AI).
  const [rules, setRules] = useState<{ as_loaded?: Battery["rules"]; fixed?: Battery["rules"] }>({});
  const [checking, setChecking] = useState(false);
  const [rulesError, setRulesError] = useState(false);
  const withRules = (b: Battery, kind: Variant) => (rules[kind] ? { ...b, rules: { ...rules[kind], ...b.rules } } : b);
  const base = withRules(battery, "as_loaded");
  const fixed = plan?.battery ? withRules(plan.battery, "fixed") : null;
  const [variant, setVariant] = useState<Variant>("as_loaded");
  const shown = activeBattery(variant === "fixed" && fixed ? fixed : base, country);
  const verdict = verdictOf(shown);

  const switchCountry = async (next: Country) => {
    setRulesError(false);
    if (!hasRules(base, next) || (fixed && !hasRules(fixed, next))) {
      if (!fetchRules) {
        setRulesError(true);
        return;
      }
      setChecking(true);
      try {
        const [loaded, fixedRules] = await Promise.all([
          hasRules(base, next) ? Promise.resolve(base.rules) : fetchRules({ ...battery.draft, country: next }),
          fixed && !hasRules(fixed, next) && plan ? fetchRules({ ...plan.draft, country: next }) : Promise.resolve(fixed?.rules),
        ]);
        setRules({ as_loaded: loaded ?? undefined, fixed: fixedRules ?? undefined });
      } catch {
        setRulesError(true);
        setChecking(false);
        return;
      }
      setChecking(false);
    }
    setCountry(next);
    choose(next);
    onCountryChange?.(next);
  };
  const problem = useMainProblem();
  const [simulation, setSimulation] = useState<SituationId | null>(null);
  const simRef = useRef<HTMLDivElement>(null);

  const open = (id: SituationId) => {
    setSimulation(id);
    requestAnimationFrame(() => simRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  return (
    <UnitsProvider country={country}>
    <div data-testid="inspection-result" data-state={verdict.state} data-variant={variant} data-passed={physicsPassed(shown)} data-country={country}>
      <CountrySwitch country={country} onChange={switchCountry} busy={checking} error={rulesError} />
      {fixed && (
        <div className="mb-6 inline-flex rounded-full bg-surface p-1" role="group" aria-label={t("fix.variant")}>
          {(["as_loaded", "fixed"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={variant === value}
              onClick={() => {
                setVariant(value);
                setSimulation(null);
              }}
              className={pill({ variant: variant === value ? "primary" : "secondary", className: "h-10 px-4" })}
              data-testid={`variant-${value}`}
            >
              {t(`fix.${value}`)}
            </button>
          ))}
        </div>
      )}

      <section aria-labelledby="verdict-title" data-testid="verdict" data-state={verdict.state}>
        <StateBadge state={verdict.state} />
        <h1 id="verdict-title" className="type-hero mt-4 text-balance" data-testid="scorecard">
          {t(`verdict.${verdict.state}.title`)}
        </h1>
        {verdict.problem ? (
          <p className="type-card-title mt-3 text-pretty" data-testid="main-problem">
            {problem(verdict.problem)}
          </p>
        ) : (
          <p className="type-body mt-3 text-pretty">{t(variant === "fixed" ? "verdict.approved.fixed" : "verdict.approved.sentence")}</p>
        )}
        <p className="type-small mt-2 text-gray">
          {t("verdict.count", { passed: physicsPassed(shown), total: shown.situations.length })}
        </p>
        {country === "EU" && <RoadsideClass checks={shown.contran_945} />}
        {weightSource === "estimated" && range && (
          <p className="mt-3 inline-flex rounded-full bg-warn-tint px-3 py-1 text-[0.8125rem] font-medium text-warn" data-testid="weight-estimated">
            <EstimatedRange low={range.low_kg} high={range.high_kg} />
          </p>
        )}
        {illustrativeKg !== null && (
          <p className="mt-3 inline-flex rounded-full bg-surface px-3 py-1 text-[0.8125rem] font-medium text-gray" data-testid="weight-illustrative">
            <IllustrativeWeight kg={illustrativeKg} />
          </p>
        )}
        {provenBy && <div className="mt-3">{provenBy}</div>}
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => open(simulation ?? shown.worst)}
            className={pill({ className: "h-12 px-5" })}
            data-testid="open-simulation"
          >
            {t("sim.open")}
          </button>
          {share}
        </div>
      </section>

      {before && <BeforeAfter before={activeBattery(before, country)} after={activeBattery(base, country)} />}

      <ReadingSummary battery={battery} truck={truck} analysis={analysis} links={links} truckAssumed={truckAssumed} onCorrect={readOnly ? undefined : onCorrect} />

      <div ref={simRef} className="scroll-mt-4">
        {simulation && (
          <SimulationPanel
            key={`${variant}-${simulation}`}
            battery={shown}
            situation={simulation}
            staticRuns={sampleRuns?.[variant]}
            onClose={() => setSimulation(null)}
          />
        )}
      </div>

      <Checklist battery={shown} onOpenSituation={open} onHeadboard={variant === "as_loaded" ? onHeadboard : undefined}
        onFrontEndRating={variant === "as_loaded" ? onFrontEndRating : undefined}
        readOnly={readOnly}
      />

      {variant === "as_loaded" && !readOnly && (
        <FixPanel
          battery={activeBattery(base, country)}
          plan={plan && fixed ? { ...plan, battery: activeBattery(fixed, country) } : plan}
          fixing={fixing}
          startedAt={fixStartedAt}
          onApplyFix={onApplyFix}
          onShowFixed={() => {
            setVariant("fixed");
            const worst = plan?.battery?.worst ?? null;
            setSimulation(null);
            requestAnimationFrame(() => {
              if (worst) open(worst);
              else window.scrollTo({ top: 0, behavior: "smooth" });
            });
          }}
          onReinspect={onReinspect}
          error={error}
        />
      )}
      {(readOnly || variant === "fixed") && plan && plan.changes.length > 0 && <ChangeList changes={plan.changes} title={t("fix.applied")} />}
    </div>
    </UnitsProvider>
  );
}

// ---- what was read -----------------------------------------------------------------------------

function ReadingSummary({
  battery,
  truck,
  analysis,
  links,
  truckAssumed = false,
  onCorrect,
}: {
  battery: Battery;
  truck: TruckChoice | null;
  analysis: PhotoAnalysis | null;
  links: UnitLink[];
  truckAssumed?: boolean;
  onCorrect?: () => void;
}) {
  const t = useTranslations("Driver.summary");
  const names = useTranslations("Driver");
  const options = useTranslations("Explorer.options");
  const measure = useShownUnits();
  const draft = battery.draft;
  const choice = truck ?? { size: draft.truck.size, style: draft.truck.style ?? (draft.truck.body === "flatbed" ? "open_low_sides" : draft.truck.body) };
  const units = footprints(draft, battery.scenario);
  const cargo = [...new Set(draft.units.map((u) => u.cargo))];
  const straps = draft.units.reduce((sum, u) => sum + u.straps, 0);
  const halfBed = battery.scenario.bed.length_m / 2;
  const gap = Math.max(0, halfBed - Math.max(...units.map((u) => u.x + u.length / 2)));
  const position = gap <= 0.15 ? t("position.headboard") : t("position.gap", { gap: measure.length(gap) });
  const restraint =
    draft.restraint === "top_over" || draft.restraint === "rope"
      ? t(draft.restraint === "rope" ? "restraint.ropes" : "restraint.straps", { count: straps })
      : options(`restraint.${draft.restraint}` as never);

  // Low confidence: what the AI was unsure of, and units cut off at the side of the photo.
  const flags: string[] = [];
  if (truckAssumed) flags.push(t("flags.truckAssumed"));
  if (analysis) {
    if (analysis.truck.confidence < 0.6) flags.push(t("flags.truck"));
    for (const unit of analysis.units) if (unit.confidence < 0.6) flags.push(t("flags.unit", { number: unit.number, why: unit.uncertain || t("flags.unsure") }));
    for (const restraintItem of analysis.restraints) if (restraintItem.confidence < 0.6) flags.push(t("flags.restraint", { why: restraintItem.uncertain || t("flags.unsure") }));
    const cut = cutOffUnits(analysis.units);
    if (cut.length) flags.push(t("flags.cutOff", { units: cut.join(", ") }));
  }
  const linkedNumbers = new Set(links.map((l) => l.number));
  const dropped = analysis ? analysis.units.filter((u) => !linkedNumbers.has(u.number)).length : 0;
  if (links.length && dropped > 0) flags.push(t("flags.dropped", { count: dropped }));

  return (
    <section className="mt-12 rounded-md bg-surface p-4" aria-labelledby="summary-title" data-testid="reading-summary">
      <h2 id="summary-title" className="type-label">
        {t("title")}
      </h2>
      <div className="mt-3 flex items-center gap-4">
        <TruckArt size={choice.size} style={choice.style} className="h-10 w-auto shrink-0" />
        <p className="min-w-0 text-[0.9375rem] text-ink" data-testid="summary-line">
          {t("line", {
            truck: names("truck.name", { size: names(`sizes.${choice.size}.name`), body: names(`styles.${choice.style}.short`) }),
            axles: SIZE_INFO[choice.size].axles,
            units: draft.units.length,
            cargo: cargo.map((c) => options(`cargo.${c}` as never).toLocaleLowerCase()).join(", "),
            restraint,
            position,
          })}
        </p>
      </div>
      {flags.length > 0 && (
        <ul className="mt-3 space-y-1" data-testid="low-confidence">
          {(flags.length > 3 ? [...flags.slice(0, 2), t("flags.more", { count: flags.length - 2 })] : flags).map((flag) => (
            <li key={flag} className="type-small flex gap-2 text-warn">
              <span aria-hidden>!</span>
              <span>{flag}</span>
            </li>
          ))}
        </ul>
      )}
      {onCorrect && (
        <button type="button" onClick={onCorrect} className="type-small mt-3 min-h-11 text-ink underline decoration-1 underline-offset-4" data-testid="correct-reading">
          {t("correct")}
        </button>
      )}
    </section>
  );
}

function BeforeAfter({ before, after }: { before: Battery; after: Battery }) {
  const t = useTranslations("Driver.reinspection");
  const a = verdictOf(before);
  const b = verdictOf(after);
  return (
    <section className="mt-10 grid grid-cols-2 gap-3" aria-label={t("title")} data-testid="before-after">
      {[
        { label: t("before"), verdict: a, battery: before },
        { label: t("after"), verdict: b, battery: after },
      ].map((side) => (
        <div key={side.label} className="rounded-md border border-hairline p-3">
          <p className="type-label">{side.label}</p>
          <div className="mt-2">
            <StateBadge state={side.verdict.state} />
          </div>
          <p className="type-small mt-2 text-gray">{t("count", { passed: physicsPassed(side.battery), total: side.battery.situations.length })}</p>
        </div>
      ))}
      <p className="type-small col-span-2 text-ink" data-testid="proof-line">
        {b.state === "approved" ? t("proven") : t("notYet")}
      </p>
    </section>
  );
}

// ---- fix ----------------------------------------------------------------------------------------

/** An option's label in the middle of a sentence. */
function lower(label: string): string {
  return label.charAt(0).toLocaleLowerCase() + label.slice(1);
}

export function useChangeSentence() {
  const t = useTranslations("Flow");
  const { nameOf } = useReplayText();
  const restraint = useTranslations("Explorer.options");
  const units = useShownUnits();
  return (change: Change): string => {
    const cm = (m: number | undefined) => units.short(Math.abs(m ?? 0));
    switch (change.code) {
      case "straps": {
        const ids = (change as Change & { unit_ids?: string[] }).unit_ids ?? [change.unit_id];
        return t("changes.straps", {
          unit: ids.map((id) => nameOf(id)).join(", "),
          from: Number(change.before ?? 0),
          to: Number(change.after ?? 0),
          count: ids.length,
        });
      }
      case "restraint":
        return t("changes.restraint", {
          from: lower(restraint(`restraint.${String(change.before)}` as never)),
          to: lower(restraint(`restraint.${String(change.after)}` as never)),
        });
      case "spread":
        return t("changes.spread", { count: change.values.units ?? 1 });
      case "diagonal_sets":
        return t("changes.diagonalSets", {
          unit: nameOf(change.unit_id ?? ""),
          to: Number(change.after ?? 0),
          chains: change.values.chains ? "yes" : "no",
        });
      case "close_gaps":
        return t(change.values.limited_by_axles ? "changes.closeGapsAxles" : "changes.closeGaps", { distance: cm(change.values.moved_m) });
      case "balance_axles":
        return t((change.values.shift_m ?? 0) > 0 ? "changes.balanceForward" : "changes.balanceBack", {
          distance: cm(change.values.shift_m),
          load: units.weight(change.values.load_kg ?? 0, { metric: false }),
          limit: units.weight(change.values.limit_kg ?? 0, { metric: false }),
        });
      case "overweight":
        return t("changes.overweight", {
          mass: units.weight(change.values.mass_kg ?? 0, { metric: false }),
          payload: units.weight(change.values.payload_kg ?? 0, { metric: false }),
        });
      default:
        return t(`changes.${change.code}`);
    }
  };
}

/** Straps added the same way on several units read as one step. */
function groupChanges(changes: Change[]): (Change & { unit_ids?: string[] })[] {
  const out: (Change & { unit_ids?: string[] })[] = [];
  for (const change of changes) {
    const previous = out[out.length - 1];
    if (change.code === "straps" && previous?.code === "straps" && previous.before === change.before && previous.after === change.after) {
      previous.unit_ids = [...(previous.unit_ids ?? [previous.unit_id ?? ""]), change.unit_id ?? ""];
    } else out.push({ ...change });
  }
  return out;
}

function ChangeList({ changes: all, title }: { changes: Change[]; title: string }) {
  const sentence = useChangeSentence();
  const t = useTranslations("Driver.fix");
  const changes = groupChanges(all);
  if (!changes.length) return null;
  return (
    <section className="mt-8">
      <h3 className="type-label">{title}</h3>
      <ol className="mt-3 space-y-3" data-testid="fix-changes">
        {changes.map((change, n) => (
          <li key={n} className="flex gap-3" data-change={change.code}>
            <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-ink font-mono text-[0.75rem] text-paper">{n + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-ink">{sentence(change)}</span>
              {change.code === "edge_protectors" && <span className="type-small block text-gray">{t("advice")}</span>}
              {change.article && <span className="type-label mt-0.5 block">{change.article}</span>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function FixPanel({
  battery,
  plan,
  fixing,
  startedAt,
  onApplyFix,
  onShowFixed,
  onReinspect,
  error,
}: {
  battery: Battery;
  plan: Plan | null;
  fixing: boolean;
  startedAt: number | null;
  onApplyFix?: () => void;
  onShowFixed?: () => void;
  onReinspect?: () => void;
  error: string | null;
}) {
  const t = useTranslations("Driver.fix");
  const flow = useTranslations("Flow");
  if (verdictOf(battery).state === "approved") {
    return (
      <section className="mt-14" data-testid="fix-panel" data-needed="false">
        <h2 className="type-card-title">{t("title")}</h2>
        <p className="type-body mt-3">{t("none")}</p>
      </section>
    );
  }
  const proven = plan?.verified && plan.battery;
  return (
    <section className="mt-14" aria-labelledby="fix-title" data-testid="fix-panel" data-needed="true">
      <h2 id="fix-title" className="type-card-title">
        {t("title")}
      </h2>
      <p className="type-body mt-3 text-pretty">{t("sentence")}</p>
      {fixing && <Running startedAt={startedAt} label={t("finding")} />}
      {plan && <ChangeList changes={plan.changes} title={t("recommended")} />}
      {plan && (
        <p className={`type-body mt-6 ${proven ? "text-pass" : "text-ink"}`} data-testid="fix-result">
          {proven
            ? t("proven")
            : plan.battery && verdictOf(plan.battery).state === "holds_noncompliant"
              ? t("holdsOnly")
              : t("notProven", { passed: plan.battery ? physicsPassed(plan.battery) : 0, total: plan.battery?.situations.length ?? 7 })}
        </p>
      )}
      {!fixing && (
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          {plan?.battery ? (
            <button type="button" onClick={onShowFixed} className={pill({ className: "h-14 px-6 text-base" })} data-testid="apply-fix">
              {t("simulate")}
            </button>
          ) : (
            <button type="button" onClick={onApplyFix} className={pill({ className: "h-14 px-6 text-base" })} data-testid="find-fix">
              {t("find")}
            </button>
          )}
          {onReinspect && (
            <button type="button" onClick={onReinspect} className={pill({ variant: "secondary", className: "h-14 px-6 text-base" })} data-testid="reinspect">
              {t("reinspect")}
            </button>
          )}
        </div>
      )}
      {onReinspect && <p className="type-small mt-2 text-gray">{t("reinspectHint")}</p>}
      {error && !fixing && (
        <p role="alert" className="type-small mt-3 text-fail">
          {flow.has(`errors.${error}` as never) ? flow(`errors.${error}` as never) : flow("errors.failed")}
        </p>
      )}
    </section>
  );
}

/** A long server run: what is happening and how long it has taken so far. */
export function Running({ startedAt, label, situations = false }: { startedAt: number | null; label: string; situations?: boolean }) {
  const t = useTranslations("Flow");
  const situationName = useSituationName();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);
  const seconds = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
  return (
    <div role="status" aria-live="polite" className="mt-6" data-testid="running">
      <p className="font-[450] text-ink">{label}</p>
      <p className="type-small mt-1 text-gray">{t("running.elapsed", { seconds })}</p>
      <div className="mt-3 h-0.5 w-full max-w-md overflow-hidden bg-surface" aria-hidden>
        <div className="h-full w-1/3 animate-[indeterminate_1.1s_ease-in-out_infinite] bg-ink" />
      </div>
      {situations && (
        <ul className="type-small mt-4 grid grid-cols-1 gap-1 text-gray sm:grid-cols-2">
          {SITUATION_IDS.map((id) => (
            <li key={id}>· {situationName(id)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function IllustrativeWeight({ kg }: { kg: number }) {
  const t = useTranslations("Driver");
  const units = useShownUnits();
  return <>{t("weight.sampleInvoice", { weight: units.mass(kg) })}</>;
}

function EstimatedRange({ low, high }: { low: number; high: number }) {
  const t = useTranslations("Driver");
  const units = useShownUnits();
  return <>{t("verdict.estimated", { low: units.mass(low), high: units.mass(high) })}</>;
}
