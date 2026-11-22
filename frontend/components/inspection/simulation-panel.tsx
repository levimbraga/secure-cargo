"use client";

/**
 * "Open the simulation": the load in 3D in one situation of the battery (the worst one first),
 * told as one story: the situation's name, one plain sentence of what happens and why (the
 * numbers one tap below), the 3D replay, and "What went wrong" in that situation.
 *
 * The seven situations are tabs. "Try another situation" (collapsed, next to the tabs) changes
 * the road, weather or speed of the selected one, offering only the choices that change the
 * physics (`lib/inspection/trip-options.ts`). As long as the trip is the battery's, the stored
 * server run is replayed (no API needed; a sample works offline). A changed trip runs the load
 * live in the browser (MuJoCo WebAssembly, through the explorer's runner), "live, not certified".
 */

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { ExplorerScene } from "@/components/explorer/explorer-scene";
import { useReasonSentence } from "@/components/lab/lab-result";
import { useReplayText } from "@/components/scenario/replay-shared";
import { pill } from "@/components/ui/pill";
import { VerdictBadge } from "@/components/ui/verdict-badge";
import { useShownCountry, useShownUnits } from "@/components/units-context";
import { Link } from "@/i18n/navigation";
import type { Finding } from "@/lib/demo";
import { encodeDraft, type LoadDraft } from "@/lib/explorer/draft";
import { type ExplorerRun, useExplorer } from "@/lib/explorer/use-explorer";
import { simulateSituation } from "@/lib/inspection/client";
import { fetchSampleRun } from "@/lib/inspection/samples";
import {
  rainChangesNothing,
  roadOptions,
  sameTrip,
  shownRoad,
  shownWeather,
  speedMatters,
  type Trip,
  weatherOptions,
  withChoice,
} from "@/lib/inspection/trip-options";
import { type Battery, SITUATION_IDS, type ServerRunResult, type SituationId } from "@/lib/inspection/types";
import { findingRank, mainFinding, physicalFindings } from "@/lib/inspection/verdict";
import { parseKeyframes } from "@/lib/keyframes";
import type { LiveRun } from "@/lib/live/engine";
import { explain } from "@/lib/live/reason";

import { useSituationName } from "./checklist";

export function toRun(result: ServerRunResult): ExplorerRun {
  const doc = parseKeyframes(result.keyframes);
  return { source: "server", summary: result, doc, reason: explain(result, doc), runMs: 0 };
}

function Chips<T extends string>({ label, options, value, name, onChoose }: { label: string; options: readonly T[]; value: T; name: (v: T) => string; onChoose: (v: T) => void }) {
  return (
    <fieldset className="mt-4">
      <legend className="type-label">{label}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={value === option}
            onClick={() => onChoose(option)}
            data-option={option}
            className={pill({ variant: value === option ? "primary" : "secondary", className: "h-11 px-4" })}
          >
            {name(option)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function SimulationPanel({
  battery,
  situation: initial,
  staticRuns,
  onClose,
}: {
  battery: Battery;
  situation: SituationId;
  /** Static runs of a sample's situations (no API needed). */
  staticRuns?: Partial<Record<SituationId, string>>;
  onClose?: () => void;
}) {
  const t = useTranslations("Driver.sim");
  const situationName = useSituationName();
  const situationOf = (id: SituationId) => battery.situations.find((s) => s.id === id) ?? battery.situations[0];
  const tripOf = (id: SituationId) => situationOf(id)?.trip ?? battery.draft.trip;
  const [trip, setTrip] = useState<Trip>(() => tripOf(initial));
  // The tested situation the trip is (the same physics), else the trip is the driver's own.
  const tested = SITUATION_IDS.find((id) => {
    const s = battery.situations.find((item) => item.id === id);
    return s && sameTrip(s.trip, trip);
  });
  const base = (SITUATION_IDS as readonly string[]).includes(trip.event) ? (trip.event as SituationId) : null;

  return (
    <section
      className="mt-6 rounded-md border border-hairline p-4 sm:p-6"
      aria-labelledby="sim-title"
      data-testid="simulation-panel"
      data-situation={tested ?? "custom"}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="type-label">{t("label")}</p>
          <h2 id="sim-title" className="type-card-title mt-2 text-pretty" data-testid="sim-title">
            {tested ? situationName(tested, situationOf(tested)?.event.speed_kmh) : base ? t("customOf", { situation: situationName(base, trip.speed_kmh) }) : t("custom")}
          </h2>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} className="type-small min-h-11 shrink-0 text-gray underline decoration-1 underline-offset-4">
            {t("close")}
          </button>
        )}
      </div>

      <SituationTabs battery={battery} selected={base} onSelect={(id) => setTrip(tripOf(id))} />

      <TryAnother trip={trip} changed={!tested} onChange={setTrip} onReset={() => base && setTrip(tripOf(base))} draft={battery.draft} />

      {tested ? (
        <StoredRun key={tested} battery={battery} situation={tested} staticRun={staticRuns?.[tested]} />
      ) : (
        <LiveRunView key={JSON.stringify(trip)} draft={{ ...battery.draft, trip }} />
      )}
    </section>
  );
}

/**
 * The seven situations. A desktop shows them all, wrapped; a phone scrolls them sideways, with
 * a fade and arrows at the edge that has more, and keeps the selected one in view.
 */
function SituationTabs({ battery, selected, onSelect }: { battery: Battery; selected: SituationId | null; onSelect: (id: SituationId) => void }) {
  const t = useTranslations("Driver.sim");
  const situationName = useSituationName();
  const country = useShownCountry();
  const strip = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  const measure = () => {
    const el = strip.current;
    if (!el) return;
    const scrollable = el.scrollWidth > el.clientWidth + 1;
    setEdges({ start: scrollable && el.scrollLeft > 4, end: scrollable && el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  };
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // The selected tab scrolled into view (sideways only: the page itself does not move); again
  // once the arrows appear, since they narrow the strip.
  const arrows = edges.start || edges.end;
  const centred = useRef(false);
  useEffect(() => {
    const el = strip.current;
    const tab = el?.querySelector<HTMLElement>(`[data-sim-situation="${selected}"]`);
    if (!el || !tab || el.scrollWidth <= el.clientWidth) return;
    // Centred; a tab wider than the strip (a long name on a phone) shows from its start.
    const start = tab.offsetLeft - el.offsetLeft;
    const left = tab.offsetWidth >= el.clientWidth ? start : start - (el.clientWidth - tab.offsetWidth) / 2;
    el.scrollTo({ left, behavior: centred.current ? "smooth" : "auto" });
    centred.current = true;
  }, [selected, arrows]);
  const nudge = (direction: 1 | -1) => strip.current?.scrollBy({ left: direction * strip.current.clientWidth * 0.7, behavior: "smooth" });

  const arrow = (edge: "start" | "end") => (
    <button
      type="button"
      onClick={() => nudge(edge === "start" ? -1 : 1)}
      aria-label={t(edge === "start" ? "previous" : "next")}
      disabled={!edges[edge]}
      className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-surface text-lg text-ink disabled:opacity-30 sm:hidden"
      data-testid={`tabs-${edge}`}
    >
      <span aria-hidden>{edge === "start" ? "‹" : "›"}</span>
    </button>
  );

  return (
    <div className="mt-4 flex items-center gap-1.5 sm:block" data-testid="situation-tabs">
      {(edges.start || edges.end) && arrow("start")}
      <div className="relative min-w-0 flex-1">
        <div
          ref={strip}
          onScroll={measure}
          className="flex gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden"
          role="group"
          aria-label={t("situations")}
        >
          {SITUATION_IDS.map((id) => {
            const s = battery.situations.find((item) => item.id === id);
            if (!s) return null;
            const mark = physicalFindings(s.findings as Finding[], country);
            const color = mark.some((f) => f.severity === "fail") ? "bg-fail" : mark.length ? "bg-amber" : "bg-pass";
            return (
              <button
                key={id}
                type="button"
                aria-pressed={selected === id}
                onClick={() => onSelect(id)}
                className={pill({ variant: selected === id ? "primary" : "secondary", className: "h-10 shrink-0 px-3" })}
                data-sim-situation={id}
              >
                <span aria-hidden className={`mr-1.5 inline-block size-2 rounded-full ${color}`} />
                {situationName(id, s.event.speed_kmh)}
              </button>
            );
          })}
        </div>
        {edges.start && <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-4 bg-gradient-to-r from-paper to-transparent sm:hidden" />}
        {edges.end && <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-4 bg-gradient-to-l from-paper to-transparent sm:hidden" />}
      </div>
      {(edges.start || edges.end) && arrow("end")}
    </div>
  );
}

/** The road, weather and speed of the selected situation, collapsed: only choices that change the physics. */
function TryAnother({ trip, changed, onChange, onReset, draft }: { trip: Trip; changed: boolean; onChange: (trip: Trip) => void; onReset: () => void; draft: LoadDraft }) {
  const t = useTranslations("Driver.sim");
  const units = useShownUnits();
  const [speed, setSpeed] = useState<number | null>(null);
  const curve = trip.event === "sharp_curve" || trip.event === "mountain_descent";
  const roadName = (road: Trip["road"]) =>
    curve
      ? t(`roads.${road === "dirt" ? "dirtBends" : road === "mountain" ? "tightBends" : "highwayBends"}`, { radius: units.length(road === "mountain" ? 40 : 60) })
      : t(`roads.${road === "dirt" ? "dirt" : "paved"}`);
  const commit = () => {
    if (speed === null) return;
    onChange(withChoice(trip, { speed_kmh: speed }));
    setSpeed(null);
  };
  return (
    <details className="group mt-4 rounded-md bg-surface" open={changed || undefined} data-testid="try-another">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="font-[450] text-ink">{t("tryAnother")}</span>
        <span aria-hidden className="text-gray transition-transform group-open:rotate-90">
          ›
        </span>
      </summary>
      <div className="px-4 pb-4">
        <p className="type-small text-gray">{t("tryAnotherHint")}</p>
        <Chips label={t("road")} options={roadOptions(trip.event)} value={shownRoad(trip)} name={roadName} onChoose={(road) => onChange(withChoice(trip, { road }))} />
        <Chips
          label={t("weather")}
          options={weatherOptions(trip.event, trip.road)}
          value={shownWeather(trip)}
          name={(weather) => t(`weathers.${weather}`)}
          onChoose={(weather) => onChange(withChoice(trip, { weather }))}
        />
        {rainChangesNothing(trip.event, trip.road) && <p className="type-small mt-2 text-gray">{t("rainNote")}</p>}
        {speedMatters(trip.event) ? (
          <div className="mt-4">
            <label className="type-label flex items-center justify-between" htmlFor="sim-speed">
              <span>{t("speed")}</span>
              <output className="font-mono text-ink" data-testid="sim-speed-value">
                {units.speed(speed ?? trip.speed_kmh)}
              </output>
            </label>
            <input
              id="sim-speed"
              type="range"
              min={20}
              max={100}
              step={10}
              value={speed ?? trip.speed_kmh}
              onChange={(event) => setSpeed(Number(event.target.value))}
              onPointerUp={commit}
              onKeyUp={commit}
              onBlur={commit}
              className="mt-2 block h-11 w-full accent-ink"
            />
          </div>
        ) : (
          <p className="type-small mt-4 text-gray">{t("speedNote")}</p>
        )}
        <div className="mt-5 flex flex-wrap gap-3">
          {changed && (
            <button type="button" onClick={onReset} className={pill({ variant: "secondary", className: "h-11 px-4" })} data-testid="sim-reset">
              {t("reset")}
            </button>
          )}
          <Link href={`/app/explorer#draft=${encodeDraft({ ...draft, trip })}`} className={pill({ variant: "secondary", className: "h-11 px-4" })}>
            {t("explorer")}
          </Link>
        </div>
      </div>
    </details>
  );
}

type Subject = { cargo: string; count: number };

/** What the load is called in a sentence: "The cartons", "The machine", "The load". */
function useSubject(draft: LoadDraft): Subject {
  const kinds = [...new Set(draft.units.map((unit) => unit.cargo))];
  // Sacks, pipes and cartons are many things even in one unit.
  const plural = kinds.length === 1 && ["sacks", "long_pipes", "stacked_boxes"].includes(kinds[0] ?? "");
  return kinds.length === 1 ? { cargo: kinds[0] as string, count: plural ? 2 : draft.units.length } : { cargo: "mixed", count: 1 };
}

/**
 * One plain sentence first ("The cartons hold: friction is stronger than the push of the
 * bump."), about the same failure and unit as the headline; the numbers one tap below.
 */
function Explanation({ run, findings, event, draft, status }: { run: ExplorerRun | null; findings: Finding[] | null; event: string; draft: LoadDraft; status: string | null }) {
  const t = useTranslations("Driver.sim");
  const sentence = useReasonSentence();
  const country = useShownCountry();
  const { nameOf } = useReplayText();
  const subject = useSubject(draft);
  const lashed = draft.restraint !== "none" || draft.units.some((unit) => unit.straps > 0);
  const push = t(`push.${event}` as never);
  let plain: string | null = null;
  if (findings) {
    const main = mainFinding(findings, country);
    if (main) {
      const unit = main.unitId ? nameOf(main.unitId) : t("theLoad");
      plain = t(`plain.${main.code}` as never, { unit, push } as never);
    } else {
      plain = t("plain.holds", {
        subject: t(`subject.${subject.cargo}` as never, { count: subject.count } as never),
        count: subject.count,
        lashed: lashed ? "yes" : "no",
        push,
      });
    }
  }
  return (
    <div className="mt-5" aria-live="polite">
      {status ? (
        <VerdictBadge verdict={status === "fail" ? "fail" : status === "warning" ? "warn" : "pass"}>{t(`status.${status}` as never)}</VerdictBadge>
      ) : (
        <VerdictBadge verdict="neutral">{t("running")}</VerdictBadge>
      )}
      <p className="type-card-title mt-3 min-h-[2.4em] text-pretty" data-testid="situation-plain">
        {plain ? plain.charAt(0).toLocaleUpperCase() + plain.slice(1) : ""}
      </p>
      {run && (
        <details className="mt-1">
          <summary className="type-small min-h-11 cursor-pointer list-none py-2 text-ink underline decoration-1 underline-offset-4 sm:min-h-8 [&::-webkit-details-marker]:hidden" data-testid="show-numbers">
            {t("numbers")}
          </summary>
          <p className="type-body mt-1 text-pretty text-gray" data-testid="situation-reason">
            {sentence(run.reason)}
          </p>
        </details>
      )}
    </div>
  );
}

/**
 * "What went wrong" in the selected situation: one line per unit, the unit the headline names
 * first; "Nothing went wrong in this situation" when it holds (small movements listed below).
 */
function WhatWentWrong({ findings, first }: { findings: Finding[]; first: string | null }) {
  const t = useTranslations("Driver.sim");
  const country = useShownCountry();
  const units = useShownUnits();
  const { nameOf, findingSentence, percent } = useReplayText();
  const physical = physicalFindings(findings, country);
  const failing = physical.filter((f) => f.severity === "fail");
  const byUnit = new Map<string, Finding[]>();
  for (const finding of failing) {
    const key = finding.unit_id ?? "";
    byUnit.set(key, [...(byUnit.get(key) ?? []), finding]);
  }
  const rows = [...byUnit.entries()]
    .map(([unitId, list]) => {
      const worst = [...list].sort((a, b) => findingRank(a.code) - findingRank(b.code))[0] as Finding;
      const strap = list.filter((f) => f.code === "lashing_overloaded").reduce((most, f) => Math.max(most, f.value / (f.limit || 1)), 0);
      return { unitId, worst, strap };
    })
    .sort((a, b) => (a.unitId === first ? -1 : b.unitId === first ? 1 : findingRank(a.worst.code) - findingRank(b.worst.code)));
  const small = physical.filter((f) => f.severity !== "fail");
  return (
    <section className="mt-8" data-testid="what-went-wrong" data-holds={failing.length === 0}>
      <h3 className="type-card-title">{t("wrong.title")}</h3>
      {failing.length === 0 ? (
        <p className="type-body mt-3">{t("wrong.nothing")}</p>
      ) : (
        <ul className="type-body mt-3 space-y-1.5">
          {rows.map(({ unitId, worst, strap }) => {
            const unit = unitId ? nameOf(unitId) : t("theLoad");
            const what = t(`wrong.${worst.code}` as never, { unit, distance: units.short(Math.abs(worst.value)) } as never);
            return (
              <li key={unitId || worst.code} data-unit={unitId}>
                {what}
                {strap > 0 && worst.code !== "lashing_overloaded" && <span className="type-small text-gray"> {t("wrong.strap", { percent: percent(strap) })}</span>}
              </li>
            );
          })}
        </ul>
      )}
      {small.length > 0 && (
        <>
          <p className="type-label mt-4">{t("wrong.small")}</p>
          <ul className="type-small mt-1 space-y-1 text-gray">
            {small.map((finding, index) => (
              <li key={index}>{findingSentence(finding)}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** The battery's own run of a situation: the stored one, or the server's (cached) one. */
function StoredRun({ battery, situation, staticRun }: { battery: Battery; situation: SituationId; staticRun?: string }) {
  const t = useTranslations("Driver.sim");
  const country = useShownCountry();
  const engine = useRef<LiveRun | null>(null);
  const isWorst = situation === battery.worst;
  const [run, setRun] = useState<ExplorerRun | null>(() => (isWorst ? toRun(battery.worst_result) : null));
  const [failed, setFailed] = useState(false);
  const s = battery.situations.find((item) => item.id === situation);
  useEffect(() => {
    if (isWorst || !s) return;
    const controller = new AbortController();
    (async () => {
      const stored = await fetchSampleRun(staticRun).catch(() => null);
      return stored ?? (await simulateSituation(battery.scenario, s.event, controller.signal));
    })()
      .then((result) => setRun(toRun(result)))
      .catch(() => !controller.signal.aborted && setFailed(true));
    return () => controller.abort();
  }, [battery.scenario, isWorst, s, staticRun]);
  const findings = (s?.findings ?? []) as Finding[];
  const physical = physicalFindings(findings, country);
  const status = physical.some((f) => f.severity === "fail") ? "fail" : physical.length ? "warning" : "pass";
  const first = mainFinding(findings, country)?.unitId ?? null;
  return (
    <>
      <Explanation run={run} findings={findings} event={situation} draft={battery.draft} status={status} />
      {failed && <p className="type-small text-gray">{t("unavailable")}</p>}
      <div className="mt-4">
        <ExplorerScene run={run} engine={engine} busy={!run} event={s?.event.kind ?? "emergency_braking"} />
      </div>
      <WhatWentWrong findings={findings} first={first} />
      <p className="type-label mt-3">{t("server")}</p>
    </>
  );
}

/** A trip of the driver's choice: simulated live in the browser. */
function LiveRunView({ draft }: { draft: LoadDraft }) {
  const t = useTranslations("Driver.sim");
  const country = useShownCountry();
  const explorer = useExplorer({ kind: "draft", draft });
  const run = explorer.busy ? null : explorer.run;
  const findings = run ? (run.summary.verdict.findings as Finding[]) : null;
  return (
    <>
      <Explanation run={run} findings={findings} event={draft.trip.event} draft={draft} status={run?.summary.verdict.status ?? null} />
      {explorer.error && <p className="type-small text-fail">{t("unavailable")}</p>}
      <div className="mt-4">
        <ExplorerScene run={explorer.run} engine={explorer.engine} busy={explorer.busy} event={explorer.load?.event.kind ?? draft.trip.event} />
      </div>
      {findings && <WhatWentWrong findings={findings} first={mainFinding(findings, country)?.unitId ?? null} />}
      <p className="type-label mt-3">{t("live")}</p>
    </>
  );
}
