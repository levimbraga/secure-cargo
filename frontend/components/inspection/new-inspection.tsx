"use client";

/**
 * `/app/new`: a new inspection, phone first. Photos -> truck and weight -> review -> the battery
 * of seven situations -> the fix. `?sample=<id>` opens a sample photo directly (the landing
 * page's "Try the demo").
 */

import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

import { useMe } from "@/components/app/me-provider";
import { pill } from "@/components/ui/pill";
import { Link } from "@/i18n/navigation";
import { fetchSamples } from "@/lib/inspection/samples";
import { type Step, useInspectionFlow } from "@/lib/inspection/use-flow";

import { ResultView, Running } from "./result-view";
import { ReviewStep } from "./review-step";
import { DetailsStep, ErrorLine, PhotoStep } from "./steps";

const STEPS: Step[] = ["photos", "details", "review", "result"];

export function NewInspection() {
  const t = useTranslations("Flow");
  const { ready, signedIn } = useMe();
  const flow = useInspectionFlow();
  const { state } = flow;
  const params = useSearchParams();
  const opened = useRef(false);

  // "Try the demo": open the sample named in the address once sign-in state is known.
  const sampleId = params.get("sample");
  useEffect(() => {
    if (!ready || !sampleId || opened.current) return;
    opened.current = true;
    fetchSamples()
      .then((samples) => {
        const sample = samples.find((item) => item.id === sampleId) ?? samples[0];
        if (sample) void flow.pickSample(sample);
      })
      .catch(() => undefined);
  }, [ready, sampleId, flow]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [state.step]);

  const current = STEPS.indexOf(state.step);
  return (
    <div data-flow-step={state.step} data-testid="new-inspection">
      <ol className="mb-10 flex flex-wrap gap-x-4 gap-y-1" aria-label={t("steps.label")}>
        {STEPS.map((step, index) => (
          <li
            key={step}
            aria-current={index === current ? "step" : undefined}
            className={`type-label ${index === current ? "text-ink" : index < current ? "text-gray" : "text-gray/60"}`}
          >
            {index + 1}. {t(`steps.${step}`)}
          </li>
        ))}
      </ol>

      {state.step === "photos" && <PhotoStep flow={flow} signedIn={signedIn} />}
      {state.step === "details" && <DetailsStep flow={flow} />}
      {state.step === "review" && <ReviewStep flow={flow} />}
      {state.step === "result" && (
        <section aria-live="polite">
          {state.busy === "battery" ? (
            <>
              <p className="type-label">{t("steps.result")}</p>
              <h1 className="type-hero mt-4 text-balance">{t("running.title")}</h1>
              <Running startedAt={state.startedAt} label={t("running.battery")} situations />
            </>
          ) : state.battery ? (
            <>
              <ResultView
                battery={state.battery}
                plan={state.plan}
                fixing={state.busy === "plan"}
                fixStartedAt={state.startedAt}
                onApplyFix={() => void flow.applyFix()}
                sampleRuns={state.sample && !state.inspectionId ? state.sample.runs : undefined}
                error={state.error}
              />
              <div className="mt-16 border-t border-hairline pt-6">
                {state.inspectionId ? (
                  <p className="type-body" data-testid="saved">
                    {t("saved.yes")}{" "}
                    <Link href={`/app/inspection?id=${state.inspectionId}`} className="underline decoration-1 underline-offset-4">
                      {t("saved.open")}
                    </Link>
                  </p>
                ) : (
                  <p className="type-body text-gray">{t("saved.no")}</p>
                )}
                <div className="mt-4 flex flex-wrap gap-3">
                  <button type="button" onClick={flow.restart} className={pill({ variant: "secondary", className: "h-11 px-4" })}>
                    {t("newInspection")}
                  </button>
                  <button type="button" onClick={() => flow.goTo("review")} className={pill({ variant: "secondary", className: "h-11 px-4" })}>
                    {t("editLoad")}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <h1 className="type-hero text-balance">{t("running.failed")}</h1>
              <ErrorLine code={state.error} />
              <div className="mt-6 flex flex-wrap gap-3">
                <button type="button" onClick={() => void flow.confirm()} className={pill({ className: "h-11 px-4" })}>
                  {t("retry")}
                </button>
                <button type="button" onClick={() => flow.goTo("review")} className={pill({ variant: "secondary", className: "h-11 px-4" })}>
                  {t("editLoad")}
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
