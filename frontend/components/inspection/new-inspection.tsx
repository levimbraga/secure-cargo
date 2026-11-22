"use client";

/**
 * `/app/new`: a new inspection, phone first, one question per screen. (My trucks) -> photo ->
 * truck -> weight -> the result, with the simulation, the checklist and the fix.
 * `?sample=<id>` opens a sample photo directly (the landing page's "Try the demo"), and
 * `?reinspect=<id>` starts the new photo of a fixed load, and `?start=photos` (the demo's first
 * screen) goes straight to the photo step, past the saved-trucks question.
 */

import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

import { useMe } from "@/components/app/me-provider";
import { pill } from "@/components/ui/pill";
import { Link } from "@/i18n/navigation";
import { checkRules } from "@/lib/inspection/client";
import { fetchSamples } from "@/lib/inspection/samples";
import { type Step, useInspectionFlow } from "@/lib/inspection/use-flow";
import { verdictOf } from "@/lib/inspection/verdict";

import { ResultView, Running } from "./result-view";
import { loadTitle, ReviewStep } from "./review-step";
import { ShareButton } from "./share";
import { ErrorLine, GarageStep, PhotoStep, TruckStep, WeightStep } from "./steps";

const STEPS: Step[] = ["photos", "truck", "weight", "result"];

export function NewInspection() {
  const t = useTranslations("Driver");
  const flowT = useTranslations("Flow");
  const options = useTranslations("Explorer.options");
  const { ready, signedIn } = useMe();
  const flow = useInspectionFlow();
  const { state } = flow;
  const params = useSearchParams();
  const locale = useLocale();
  const opened = useRef(false);

  // "Try the demo" opens a sample, "I fixed it" a re-inspection, once sign-in state is known.
  const sampleId = params.get("sample");
  const reinspect = params.get("reinspect");
  useEffect(() => {
    if (!ready || opened.current) return;
    if (reinspect && signedIn) {
      opened.current = true;
      void flow.startReinspection(reinspect);
      return;
    }
    if (!sampleId) return;
    opened.current = true;
    fetchSamples()
      .then((samples) => {
        const sample = samples.find((item) => item.id === sampleId) ?? samples[0];
        if (sample) void flow.pickSample(sample);
      })
      .catch(() => undefined);
  }, [ready, signedIn, sampleId, reinspect, flow]);

  // "Try the demo" lands on the photo step: past the saved-trucks question the demo driver has.
  const startOnPhotos = params.get("start") === "photos";
  const skippedGarage = useRef(false);
  useEffect(() => {
    if (!startOnPhotos || skippedGarage.current || state.step !== "garage") return;
    skippedGarage.current = true;
    flow.pickSaved(null);
  }, [startOnPhotos, state.step, flow]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [state.step, state.truckStage]);

  // On a phone the sample photos sit below the capture cards: the demo's first screen shows them.
  const shownSamples = useRef(false);
  useEffect(() => {
    if (!startOnPhotos || shownSamples.current || state.step !== "photos") return;
    if (!window.matchMedia("(max-width: 767px)").matches) return;
    shownSamples.current = true;
    let frame = 0;
    const until = performance.now() + 4000;
    const reveal = () => {
      const samples = document.querySelector<HTMLElement>('[aria-labelledby="samples-title"]');
      if (samples) {
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        window.scrollTo({ top: samples.getBoundingClientRect().top + window.scrollY - 16, behavior: reduce ? "auto" : "smooth" });
      } else if (performance.now() < until) frame = requestAnimationFrame(reveal);
    };
    frame = requestAnimationFrame(reveal);
    return () => cancelAnimationFrame(frame);
  }, [startOnPhotos, state.step]);

  const title = state.perception
    ? loadTitle(state.perception.draft, (cargo) => options(`cargo.${cargo}` as never), flowT("review.mixed"))
    : undefined;
  const shown = state.step === "garage" ? "photos" : state.step === "edit" ? "result" : state.step;
  const current = STEPS.indexOf(shown);

  return (
    <div data-flow-step={state.step} data-testid="new-inspection">
      {state.step !== "result" && state.step !== "edit" && (
        <ol className="mb-8 flex flex-wrap gap-x-4 gap-y-1" aria-label={t("steps.label")}>
          {STEPS.map((step, index) => (
            <li
              key={step}
              aria-current={index === current ? "step" : undefined}
              // Contrast stays AA for every step: the current one is ink and underlined, the others gray.
              className={`type-label ${index === current ? "text-ink underline decoration-1 underline-offset-4" : "text-gray"}`}
            >
              {index < current ? "✓" : `${index + 1}.`} {t(`steps.${step}`)}
            </li>
          ))}
        </ol>
      )}

      {state.step === "garage" && <GarageStep flow={flow} />}
      {state.step === "photos" &&
        (ready ? <PhotoStep flow={flow} signedIn={signedIn} /> : <p className="type-small text-gray">{flowT("loading")}</p>)}
      {state.step === "truck" && <TruckStep flow={flow} />}
      {state.step === "weight" && <WeightStep flow={flow} title={title ?? ""} />}
      {state.step === "edit" && <ReviewStep flow={flow} />}
      {state.step === "result" && (
        <section aria-live="polite">
          {state.busy === "battery" ? (
            <>
              <p className="type-label">{t("steps.result")}</p>
              <h1 className="type-hero mt-4 text-balance">{t("result.running")}</h1>
              <p className="type-body mt-3 text-pretty">{t("result.runningSentence")}</p>
              <Running startedAt={state.startedAt} label={flowT("running.battery")} situations />
            </>
          ) : state.battery ? (
            <>
              <ResultView
                battery={state.battery}
                plan={state.plan}
                country={state.country}
                fetchRules={(draft) => checkRules(draft)}
                onCountryChange={flow.saveCountry}
                fixing={state.busy === "plan"}
                fixStartedAt={state.startedAt}
                onApplyFix={() => void flow.applyFix()}
                sampleRuns={state.sample && !state.inspectionId ? state.sample.runs : undefined}
                error={state.error}
                truck={state.truck}
                weightSource={state.weightSource}
                range={state.range}
                analysis={state.analysis?.analysis ?? null}
                links={state.perception?.links ?? []}
                onCorrect={() => void flow.openEditor()}
                onHeadboard={(height) => void flow.setHeadboard(height)}
                onFrontEndRating={(kg) => void flow.setFrontEndRating(kg)}
                truckAssumed={Boolean(state.sample?.truck_assumed && state.truck?.size === state.sample.truck.size)}
                onReinspect={
                  state.inspectionId
                    ? () => window.location.assign(`${locale === "pt-BR" ? "/pt-BR" : ""}/app/new?reinspect=${state.inspectionId}`)
                    : undefined
                }
                before={state.parent?.battery ?? null}
                share={
                  state.inspectionId ? (
                    <ShareButton getUrl={flow.share} verdict={t(`verdict.${verdictOf(state.battery).state}.badge`)} />
                  ) : null
                }
              />
              <div className="mt-16 border-t border-hairline pt-6">
                {state.inspectionId ? (
                  <p className="type-body" data-testid="saved">
                    {t("result.saved")}{" "}
                    <Link href={`/app/inspection?id=${state.inspectionId}`} className="underline decoration-1 underline-offset-4">
                      {t("result.open")}
                    </Link>
                  </p>
                ) : (
                  <p className="type-body text-gray">{t("result.notSaved")}</p>
                )}
                <div className="mt-4 flex flex-wrap gap-3">
                  <button type="button" onClick={flow.restart} className={pill({ variant: "secondary", className: "h-11 px-4" })}>
                    {t("result.new")}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <h1 className="type-hero text-balance">{t("result.failed")}</h1>
              <ErrorLine code={state.error} />
              <div className="mt-6 flex flex-wrap gap-3">
                <button type="button" onClick={() => void flow.toResult(title)} className={pill({ className: "h-11 px-4" })}>
                  {flowT("retry")}
                </button>
                <button type="button" onClick={() => flow.goTo("weight")} className={pill({ variant: "secondary", className: "h-11 px-4" })}>
                  {flowT("back")}
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
