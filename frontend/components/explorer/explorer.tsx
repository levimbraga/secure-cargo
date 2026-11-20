"use client";

/**
 * The explorer: any truck, load, securing and trip, simulated live. The verdict and its reason
 * come first; then the load editor (the top view of the bed), the 3D run, and one selector per
 * dimension. The configuration lives in the page URL, so any load can be shared as a link.
 */

import { useFormatter, useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";

import { useReasonSentence } from "@/components/lab/lab-result";
import { Findings, ResultRows, useReplayText } from "@/components/scenario/replay-shared";
import { SectionLabel } from "@/components/ui/section-label";
import { VerdictBadge } from "@/components/ui/verdict-badge";
import { sourceFromLocation, useExplorer } from "@/lib/explorer/use-explorer";

import { ExplorerScene } from "./explorer-scene";
import { LoadEditor } from "./load-editor";
import { Selectors } from "./selectors";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

/** The address is only known in the browser: the explorer renders a placeholder until then. */
export function Explorer() {
  const location = useSyncExternalStore(
    subscribe,
    () => `${window.location.search}${window.location.hash}`,
    () => null,
  );
  const t = useTranslations("Explorer");
  if (location === null) {
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
    </header>
  );
}

function ExplorerSession() {
  // Read once: afterwards the explorer writes the address itself.
  const explorer = useExplorer(sourceFromLocation(window.location));
  const t = useTranslations("Explorer");
  const lab = useTranslations("Lab");
  const format = useFormatter();
  const { t: scenario, standardValue } = useReplayText();
  const sentence = useReasonSentence();
  const { run, load, draft } = explorer;
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
            <LoadEditor load={load} draft={draft} onEdit={explorer.edit} />
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
              <h2 className="type-card-title">{scenario("rows.title")}</h2>
              <ResultRows
                run={run.summary}
                event={lab("eventLine", {
                  event: lab(`events.${load?.event.kind ?? "emergency_braking"}` as never),
                  speed: format.number(load?.event.speed_kmh ?? 0),
                  surface: lab(`surfaces.${load?.event.road_surface ?? "dry"}` as never),
                })}
              />
              <Findings run={run.summary} />
            </div>
          )}
        </div>

        <aside className="contents lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:block">
        {/* The answer first, as everywhere in the app. */}
          <div className="order-1" aria-live="polite">
          {run && status ? (
            <>
              <VerdictBadge verdict={status === "pass" ? "pass" : "fail"}>{scenario(`verdict.${status}`)}</VerdictBadge>
              <p data-testid="explorer-reason" className="type-card-title mt-3 text-pretty">
                {sentence(run.reason)}
              </p>
              <p className="type-small mt-2 text-gray">{lab("result.standard", { value: standardValue(run.summary) })}</p>
            </>
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
