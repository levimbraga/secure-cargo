"use client";

import { createContext, useContext } from "react";
import { useFormatter, useTranslations } from "next-intl";

import { useReplayText } from "@/components/scenario/replay-shared";
import { VerdictBadge } from "@/components/ui/verdict-badge";
import { useShownUnits } from "@/components/units-context";
import type { Reason } from "@/lib/live/reason";
import type { FallbackReason, LabError, LabRun } from "@/lib/live/use-live-lab";

/** Server answers faster than this came from the static files: not worth a line [ms]. */
const SHOW_SERVER_TIME_MS = 50;

/**
 * Share of the current run simulated so far, 0..1. It changes many times a second, so it travels
 * in a context of its own and only the progress bar renders with it.
 */
const Progress = createContext(0);
export const LabProgress = Progress.Provider;

function ProgressBar({ busy, label }: { busy: boolean; label: string }) {
  const progress = useContext(Progress);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={busy ? Math.round(progress * 100) : 100}
      aria-hidden={!busy}
      className={`mt-3 h-0.5 overflow-hidden rounded-full ${busy ? "bg-hairline" : "bg-transparent"}`}
    >
      {busy && (
        <div
          className={`h-full bg-ink ${progress > 0 ? "" : "animate-pulse"}`}
          style={{ width: progress > 0 ? `${Math.round(progress * 100)}%` : "30%" }}
        />
      )}
    </div>
  );
}

/** The reason behind a verdict as one sentence with its numbers. */
export function useReasonSentence(): (reason: Reason) => string {
  const t = useTranslations("Lab.reason");
  const format = useFormatter();
  const { nameOf } = useReplayText();
  const units = useShownUnits();
  const fixed = (value: number, digits: number) =>
    format.number(value, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  // The reason's values: forces in kN, moments in kN·m, distances in cm, weights in t.
  const force = (kn: number) => units.force(kn * 1000, { metric: false });
  const moment = (knm: number) => units.moment(knm * 1000);

  return (reason) => {
    const value = (key: string) => reason.values[key] ?? 0;
    const unit = nameOf(reason.subject);
    const inertia = force(value("inertia"));
    const friction = force(value("friction"));
    const slide = units.short(value("slide") / 100);
    const overturning = moment(value("overturning"));
    const restoring = moment(value("restoring"));
    switch (reason.key) {
      case "slides":
      case "slidesIntoHeadboard":
      case "slidesLoose":
        return t(reason.key, { inertia, friction, unit, slide });
      case "slidesIntoWall":
        return t("slidesIntoWall", {
          inertia,
          friction,
          unit,
          slide,
          force: force(value("force")),
          capacity: force(value("capacity")),
        });
      case "slidesAfterLoosening":
        return t("slidesAfterLoosening", {
          before: force(value("before")),
          after: force(value("after")),
          inertia,
          friction,
          unit,
          slide,
        });
      case "rolls":
      case "rollsIntoHeadboard":
        return t(reason.key, { inertia, unit, slide });
      case "holdsUpright":
      case "holdsUprightBarely":
        return t(reason.key, { overturning, restoring, unit });
      case "holdsTall":
        return value("inertia") > value("friction")
          ? t(value("lashed") > 0 ? "holdsTallLashed" : "holdsTallBlocked", { inertia, friction, overturning, restoring, unit })
          : t("holdsTall", { inertia, friction, overturning, restoring, unit });
      case "leavesBed":
        // A unit that fell without sliding first (it tipped over the edge) has no force balance.
        return value("inertia") > 0 ? t("leavesBed", { inertia, friction, unit }) : t("leavesBedPlain", { unit });
      case "tips":
        return t("tips", {
          overturning,
          restoring,
          unit,
          tilt: fixed(value("tilt"), 0),
        });
      case "lashingOverloaded":
      case "lashingBroke":
      case "headboardOverloaded":
        return t(reason.key, { force: force(value("force")), capacity: force(value("capacity")) });
      case "axleOverloaded":
        return t("axleOverloaded", {
          axle: reason.subject ?? "rear",
          load: units.weight(value("load") * 1000, { metric: false }),
          limit: units.weight(value("limit") * 1000, { metric: false }),
        });
      case "holds":
      case "holdsBarely":
        // Friction alone does not hold a unit under direct lashings: say what does.
        if (value("inertia") <= value("friction")) return t(reason.key, { inertia, friction });
        // Friction alone does not hold it: lashings do, or walls and blocks when there are none.
        return value("lashed") > 0 || reason.values.lashed === undefined
          ? t(`${reason.key}Lashed`, { inertia, friction })
          : t(`${reason.key}Blocked`, { inertia, friction });
    }
  };
}

/**
 * The answer of the live lab, always next to the scene: the verdict, the reason in one sentence
 * with numbers, the EN 12195-1 check, and where the numbers were computed. While the next run is
 * simulated the previous answer stays, under a thin progress bar.
 */
export function LabResult({
  run,
  busy,
  error,
  fallback,
  authored,
  onReset,
}: {
  run: LabRun | null;
  busy: boolean;
  error: LabError | null;
  fallback: FallbackReason | null;
  authored: boolean;
  onReset: () => void;
}) {
  const t = useTranslations("Lab");
  const format = useFormatter();
  const { t: scenario, standardValue } = useReplayText();
  const sentence = useReasonSentence();
  const seconds = (milliseconds: number) =>
    format.number(milliseconds / 1000, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const status = run?.summary.verdict.status;

  return (
    <section aria-label={t("result.title")}>
      <div aria-live="polite">
        {run && status ? (
          <>
            <VerdictBadge verdict={status === "pass" ? "pass" : "fail"}>{scenario(`verdict.${status}`)}</VerdictBadge>
            <p data-testid="lab-reason" className="type-card-title mt-3 text-pretty">
              {sentence(run.reason)}
            </p>
            <p className="type-small mt-2 text-gray">
              {t("result.standard", { value: standardValue(run.summary) })}
            </p>
          </>
        ) : (
          <>
            <VerdictBadge verdict="neutral">{error ? t("state.error") : t("state.running")}</VerdictBadge>
            {/* The space of the sentence, so the page does not jump when it arrives. */}
            <p className="type-card-title mt-3 min-h-[2.4em] text-gray">{error ? "" : t("state.loading")}</p>
          </>
        )}
      </div>

      {/* Progress of the run being simulated; the previous result stays readable above. */}
<ProgressBar busy={busy} label={t("result.progress")} />

      {error && (
        <div role="alert" className="mt-3">
          <p className="type-small text-fail">{t(`errors.${error}`)}</p>
          {error !== "load_failed" && !authored && (
            <button
              type="button"
              onClick={onReset}
              className="mt-1 min-h-11 text-left text-sm text-ink underline decoration-1 underline-offset-4 sm:min-h-8"
            >
              {t("reset")}
            </button>
          )}
        </div>
      )}

      {run && (
        <div className="mt-3">
          <span
            data-testid="lab-source"
            className="inline-flex h-6 items-center rounded-full bg-surface px-2.5 text-[0.8125rem] font-medium text-gray"
          >
            {run.source === "browser" ? t("live.badge") : t("live.serverBadge")}
          </span>
          <p className="type-label mt-2 text-pretty">
            {run.source === "browser"
              ? t("live.browser", { seconds: seconds(run.runMs) })
              : `${t(`live.server.${fallback ?? "other"}`)}${
                  run.runMs >= SHOW_SERVER_TIME_MS ? ` ${t("live.serverTime", { seconds: seconds(run.runMs) })}` : ""
                }`}
          </p>
        </div>
      )}
    </section>
  );
}
