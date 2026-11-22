"use client";

/**
 * The explorer: any truck, load, securing and trip, simulated live. The verdict and its reason
 * come first; then the load editor (the top view of the bed), the 3D run, and one selector per
 * dimension. The configuration lives in the page URL, so any load can be shared as a link.
 */

import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState, useSyncExternalStore } from "react";

import type { Trouble } from "@/lib/explorer/trouble";
import { useRuleCheck } from "@/lib/explorer/use-rule-check";
import type { Battery } from "@/lib/inspection/types";
import { physicsPassed, verdictOf } from "@/lib/inspection/verdict";

import { UnitsProvider, useShownUnits } from "@/components/units-context";
import { BodyCodeSwitch, CountrySwitch } from "@/components/inspection/country-switch";
import { ProblemSentence, StateBadge, useMainProblem } from "@/components/inspection/result-view";
import { useReasonSentence } from "@/components/lab/lab-result";
import { Findings, ResultRows, useReplayText } from "@/components/scenario/replay-shared";
import { SectionLabel } from "@/components/ui/section-label";
import { VerdictBadge } from "@/components/ui/verdict-badge";
import { Link } from "@/i18n/navigation";
import { sourceFromLocation, useExplorer } from "@/lib/explorer/use-explorer";

import { ExplorerScene } from "./explorer-scene";
import { ExplorerTrip } from "./explorer-trip";
import { LoadEditor } from "./load-editor";
import { Selectors } from "./selectors";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

/** The explorer's own path, with or without the locale prefix. */
const EXPLORER_PATH = /\/app\/explorer\/?$/;

/**
 * The address is only known in the browser: the explorer renders a placeholder until then.
 * After a client-side navigation (a link from the examples) the router updates the address
 * only once the new page has rendered, so the explorer waits until the address is its own
 * before it reads the configuration; otherwise it would read the previous page's address and
 * open the default load.
 */
export function Explorer() {
  const location = useSyncExternalStore(
    subscribe,
    () => `${window.location.search}${window.location.hash}`,
    () => null,
  );
  const [onOwnPath, setOnOwnPath] = useState(false);
  useEffect(() => {
    let frame = 0;
    const check = () => {
      if (EXPLORER_PATH.test(window.location.pathname)) {
        setOnOwnPath(true);
        // Arrived by a link from further down another page (a clip on the examples): the router
        // scrolls to its own idea of where the page starts. The explorer starts at the top, with
        // the verdict, like a page opened afresh.
        if (window.scrollY > 0 && !window.location.hash) window.scrollTo({ top: 0, behavior: "instant" });
      } else {
        frame = requestAnimationFrame(check);
      }
    };
    frame = requestAnimationFrame(check);
    return () => cancelAnimationFrame(frame);
  }, []);
  const t = useTranslations("Explorer");
  if (location === null || !onOwnPath) {
    return (
      <section data-explorer-state="loading">
        <ExplorerHeader />
        <VerdictBadge verdict="neutral">{t("state.loading")}</VerdictBadge>
      </section>
    );
  }
  return <ExplorerSession />;
}

function ExplorerHeader() {
  const t = useTranslations("Explorer");
  return (
    <header>
      <SectionLabel>{t("label")}</SectionLabel>
      <h1 className="type-hero mt-4 text-balance">{t("title")}</h1>
      <p className="type-body mt-3 max-w-[43rem] text-pretty">{t("intro")}</p>
      {/* The examples left the app header: they are one tap away from here (and in the footer). */}
      <p className="type-small mt-3">
        <Link href="/app/examples" className="underline decoration-hairline underline-offset-4 hover:decoration-ink">
          {t("examplesLink")}
        </Link>
      </p>
    </header>
  );
}

function ExplorerSession() {
  // Read once: afterwards the explorer writes the address itself.
  const explorer = useExplorer(sourceFromLocation(window.location));
  return (
    <UnitsProvider country={explorer.country}>
      <ExplorerContent explorer={explorer} />
    </UnitsProvider>
  );
}

function ExplorerContent({ explorer }: { explorer: ReturnType<typeof useExplorer> }) {
  const t = useTranslations("Explorer");
  const lab = useTranslations("Lab");
  const format = useFormatter();
  const units = useShownUnits();
  const { standardValue } = useReplayText();
  const sentence = useReasonSentence();
  const { run, load, draft } = explorer;
  // Where the whole-trip test found the load failing, while the editor shows that load.
  const [trouble, setTrouble] = useState<Trouble | null>(null);
  // The whole-trip result while the editor shows the tested load: the page then leads with it.
  const [trip, setTrip] = useState<Battery | null>(null);
  const rules = useRuleCheck(draft, explorer.country);
  const verdictText = useTranslations("Driver.verdict");
  const live = useTranslations("Explorer.live");
  const problemSentence = useMainProblem();
  const tripVerdict = trip ? verdictOf(trip) : null;
  const status = run?.summary.verdict.status;
  const state = explorer.error && !explorer.busy ? "error" : !run ? "loading" : explorer.busy ? "running" : "ready";
  const floorUnits = draft ? draft.units.filter((unit) => !unit.on) : [];
  const unitMass = load?.scenario.units[0]?.mass_kg ?? null;
  const seconds = (ms: number) => format.number(ms / 1000, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <section
      data-explorer-state={state}
      data-explorer-status={status}
      data-explorer-source={run?.source}
      data-explorer-run-ms={run ? Math.round(run.runMs) : undefined}
    >
      <ExplorerHeader />

      {/* Phones: verdict, editor, selectors, 3D run, details. Wide screens: the editor and the
          run on the left, the verdict and the selectors beside them. */}
      <div className="mt-8 flex flex-col gap-y-10 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-x-10">
        <div className="order-2 min-w-0 lg:col-start-1 lg:row-start-1">
          {load && draft ? (
            <LoadEditor load={load} draft={draft} onEdit={explorer.edit} trouble={trouble} />
          ) : (
            <div className="aspect-[3/1] w-full rounded bg-surface" aria-hidden />
          )}
          {explorer.edited && !explorer.error && (
            <button
              type="button"
              onClick={explorer.resetEdits}
              className="mt-3 min-h-11 text-left text-sm text-ink underline decoration-1 underline-offset-4 sm:min-h-8"
            >
              {t("editor.reset")}
            </button>
          )}

        </div>
        <div className="order-4 min-w-0 lg:col-start-1 lg:row-start-2">
          <div>
            <ExplorerScene run={run} engine={explorer.engine} busy={explorer.busy} event={load?.event.kind ?? ""} />
          </div>

          {run && (
            <div className="mt-12">
              <h2 className="type-card-title">{live("rowsTitle")}</h2>
              <ResultRows
                run={run.summary}
                verdict={{ label: live("rowLabel"), value: live(`rowValue.${run.summary.verdict.status}` as never) }}
                event={lab("eventLine", {
                  event: lab(`events.${load?.event.kind ?? "emergency_braking"}` as never),
                  speed: units.speed(load?.event.speed_kmh ?? 0),
                  surface: lab(`surfaces.${load?.event.road_surface ?? "dry"}` as never),
                })}
              />
              <Findings run={run.summary} />
            </div>
          )}

          <ExplorerTrip draft={draft} country={explorer.country} onApply={explorer.edit} onTrouble={setTrouble} onResult={setTrip} />
        </div>

        <aside className="contents lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:block">
        {/* The answer first, as everywhere in the app. */}
          <div className="order-1" aria-live="polite">
          <CountrySwitch country={explorer.country} onChange={explorer.setCountry} className="mb-6" />
          {explorer.country === "EU" && draft && draft.truck.body !== "flatbed" && (
            <BodyCodeSwitch code={draft.truck.body_code ?? null} onChange={(code) => explorer.choose("body_code", code)} />
          )}
          {trip && tripVerdict ? (
            // The whole trip was tested on this load: its verdict leads; the live run is one situation of it.
            <div data-testid="explorer-trip-verdict" data-state={tripVerdict.state}>
              <p className="type-label mb-2">{live("tripLabel")}</p>
              <StateBadge state={tripVerdict.state} />
              <p className="type-card-title mt-3 text-pretty">{verdictText(`${tripVerdict.state}.title`)}</p>
              {tripVerdict.problem && (
                <p className="type-body mt-2 text-pretty">
                  <ProblemSentence problem={tripVerdict.problem} battery={trip} />
                </p>
              )}
              <p className="type-small mt-2 text-gray">{verdictText("count", { passed: physicsPassed(trip), total: trip.situations.length })}</p>
            </div>
          ) : null}
          {run && status ? (
            <div className={trip ? "mt-6 border-t border-hairline pt-4" : undefined} data-testid="explorer-live-verdict">
              {trip && <p className="type-label mb-2">{live("liveLabel")}</p>}
              <VerdictBadge verdict={status === "fail" ? "fail" : !trip && rules?.problem ? "warn" : "pass"}>{live(`badge.${status}` as never)}</VerdictBadge>
              <p className="type-small mt-2 text-gray" data-testid="explorer-situation">
                {lab("eventLine", {
                  event: lab(`events.${load?.event.kind ?? "emergency_braking"}` as never),
                  speed: units.speed(load?.event.speed_kmh ?? 0),
                  surface: lab(`surfaces.${load?.event.road_surface ?? "dry"}` as never),
                })}
              </p>
              <p data-testid="explorer-reason" className={`${trip ? "type-body" : "type-card-title"} mt-2 text-pretty`}>
                {sentence(run.reason)}
              </p>
              <p className="type-small mt-2 text-gray">{lab("result.standard", { value: standardValue(run.summary) })}</p>
              {!trip && (
                <>
                  {rules && (
                    <p className="mt-3 text-sm text-pretty" data-testid="explorer-rules" data-failing={rules.failing}>
                      {rules.problem ? (
                        <>
                          <span className="mr-2 inline-flex rounded-full bg-warn-tint px-2.5 py-0.5 text-[0.8125rem] font-medium text-warn">
                            {live("rulesBreak", { count: rules.failing })}
                          </span>
                          <span className="text-ink">{problemSentence(rules.problem)}</span>
                        </>
                      ) : (
                        <span className="text-gray">{live("rulesOk")}</span>
                      )}
                    </p>
                  )}
                  <p className="type-small mt-3 text-pretty text-gray">
                    {live("oneSituation")}{" "}
                    <a href="#explorer-trip" className="text-ink underline decoration-1 underline-offset-4">
                      {live("testAll")}
                    </a>
                  </p>
                </>
              )}
            </div>
          ) : (
            <>
              <VerdictBadge verdict="neutral">{explorer.error ? lab("state.error") : lab("state.running")}</VerdictBadge>
              <p className="type-card-title mt-3 min-h-[2.4em] text-gray">{explorer.error ? "" : lab("state.loading")}</p>
            </>
          )}
          <div className="mt-3 h-0.5 w-full overflow-hidden bg-surface" aria-hidden>
            {explorer.busy && (
              <div className="h-full bg-ink transition-[width]" style={{ width: `${Math.round(explorer.progress * 100)}%` }} />
            )}
          </div>
          {explorer.error && (
            <div role="alert" className="mt-3">
              <p className="type-small text-fail">{t(`errors.${explorer.error}` as never)}</p>
              {explorer.edited && (
                <button
                  type="button"
                  onClick={explorer.resetEdits}
                  className="mt-1 min-h-11 text-left text-sm text-ink underline decoration-1 underline-offset-4 sm:min-h-8"
                >
                  {t("editor.reset")}
                </button>
              )}
            </div>
          )}
          {run && (
            <div className="mt-3">
              <span className="inline-flex h-6 items-center rounded-full bg-surface px-2.5 text-[0.8125rem] font-medium text-gray">
                {run.source === "browser" ? lab("live.badge") : lab("live.serverBadge")}
              </span>
              <p className="type-label mt-2 text-pretty">
                {run.source === "browser"
                  ? lab("live.browser", { seconds: seconds(run.runMs) })
                  : `${lab(`live.server.${explorer.fallback ?? "other"}`)} ${lab("live.serverTime", { seconds: seconds(run.runMs) })}`}
              </p>
            </div>
          )}
        </div>

          <div className="order-3 lg:mt-10">
          <Selectors
            config={explorer.config}
            units={draft ? floorUnits.length : null}
            massKg={unitMass}
            origin={explorer.origin}
            onChoose={explorer.choose}
          />
        </div>
        </aside>
      </div>
    </section>
  );
}
