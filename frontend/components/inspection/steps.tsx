"use client";

/** The first two steps of a new inspection: the photos, then the truck and the weight. */

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";

import { pill } from "@/components/ui/pill";
import { Link } from "@/i18n/navigation";
import { BODIES, SIZES } from "@/lib/explorer/config";
import { fetchSamples, type Sample } from "@/lib/inspection/samples";
import type { Body, Size } from "@/lib/inspection/types";
import { MAX_PHOTOS, type Position, type useInspectionFlow } from "@/lib/inspection/use-flow";

type Flow = ReturnType<typeof useInspectionFlow>;

const ACCEPT = "image/jpeg,image/png,image/heic,image/heif,.heic,.heif";
const POSITIONS: Position[] = ["rear", "left", "right", "front"];

export function ErrorLine({ code }: { code: string | null }) {
  const t = useTranslations("Flow");
  if (!code) return null;
  return (
    <p role="alert" className="type-small mt-3 text-fail">
      {t.has(`errors.${code}` as never) ? t(`errors.${code}` as never) : t("errors.failed")}
    </p>
  );
}

// ---- photos -------------------------------------------------------------------------------

export function PhotoStep({ flow, signedIn }: { flow: Flow; signedIn: boolean }) {
  const t = useTranslations("Flow");
  const { state } = flow;
  const busy = state.busy === "upload";
  const full = state.photos.length >= MAX_PHOTOS;
  const cameraId = useId();
  const uploadId = useId();
  const allowance = flow.allowance;
  const demoMode = allowance?.mode === "demo";

  const onFiles = (list: FileList | null) => {
    if (list?.length) void flow.addPhotos(Array.from(list));
  };

  return (
    <section aria-labelledby="photos-title">
      <p className="type-label">{t("steps.photos")}</p>
      <h1 id="photos-title" className="type-hero mt-4 text-balance">
        {t("photos.title")}
      </h1>
      <p className="type-body mt-3 text-pretty">{t("photos.sentence")}</p>

      {signedIn ? (
        <>
          {demoMode && <p className="type-small mt-4 text-fail">{t(`photos.demoMode.${allowance?.reason ?? "kill_switch"}`)}</p>}
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            {/* A label opens the camera on phones (capture), a plain file picker elsewhere. */}
            <label
              htmlFor={cameraId}
              aria-disabled={full || busy || demoMode}
              className={pill({ className: `h-14 cursor-pointer px-6 text-base ${full || busy || demoMode ? "pointer-events-none opacity-50" : ""}` })}
            >
              {busy ? t("photos.preparing") : t("photos.camera")}
            </label>
            <input
              id={cameraId}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              disabled={full || busy || demoMode}
              onChange={(event) => {
                onFiles(event.target.files);
                event.target.value = "";
              }}
            />
            <label
              htmlFor={uploadId}
              aria-disabled={full || busy || demoMode}
              className={pill({ variant: "secondary", className: `h-14 cursor-pointer px-6 text-base ${full || busy || demoMode ? "pointer-events-none opacity-50" : ""}` })}
            >
              {t("photos.upload")}
            </label>
            <input
              id={uploadId}
              type="file"
              accept={ACCEPT}
              multiple
              className="sr-only"
              disabled={full || busy || demoMode}
              onChange={(event) => {
                onFiles(event.target.files);
                event.target.value = "";
              }}
            />
          </div>
          <p className="type-small mt-3 text-gray">{t("photos.hint", { max: MAX_PHOTOS })}</p>
          <p className="type-small mt-1 text-gray">{t("photos.privacy")}</p>
        </>
      ) : (
        <div className="mt-6 rounded bg-surface p-4">
          <p className="text-ink">{t("photos.signIn")}</p>
          <Link href="/app/sign-in" className={pill({ className: "mt-3 h-11 px-4" })}>
            {t("photos.signInButton")}
          </Link>
        </div>
      )}

      <ErrorLine code={state.error} />

      {state.photos.length > 0 && !state.sample && (
        <>
          <ul className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="photo-list">
            {state.photos.map((photo, index) => (
              <li key={photo.url} className="min-w-0">
                {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of the user's own photo */}
                <img src={photo.url} alt={t("photos.alt", { number: index + 1 })} className="aspect-[4/3] w-full rounded object-cover" />
                <div className="mt-2 flex items-center gap-2">
                  <label className="sr-only" htmlFor={`position-${index}`}>
                    {t("photos.position")}
                  </label>
                  <select
                    id={`position-${index}`}
                    value={photo.position}
                    onChange={(event) => flow.setPosition(index, event.target.value as Position)}
                    className="h-11 min-w-0 flex-1 rounded-full border border-control bg-paper px-3 text-sm sm:h-8"
                  >
                    {POSITIONS.map((position) => (
                      <option key={position} value={position}>
                        {t(`positions.${position}`)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => flow.removePhoto(index)}
                    aria-label={t("photos.remove", { number: index + 1 })}
                    className="size-11 rounded-full bg-surface text-ink sm:size-8"
                  >
                    ×
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => void flow.toDetails()} className={pill({ className: "mt-8 h-12 px-6" })} data-testid="photos-next">
            {t("photos.next")}
          </button>
        </>
      )}

      <Samples flow={flow} />
    </section>
  );
}

function Samples({ flow }: { flow: Flow }) {
  const t = useTranslations("Flow");
  const pt = useLocale() === "pt-BR";
  const [samples, setSamples] = useState<Sample[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchSamples()
      .then((list) => !cancelled && setSamples(list))
      .catch(() => !cancelled && setSamples([]));
    return () => {
      cancelled = true;
    };
  }, []);
  if (samples !== null && samples.length === 0) return null;
  return (
    <section className="mt-16" aria-labelledby="samples-title">
      <h2 id="samples-title" className="type-label">
        {t("samples.title")}
      </h2>
      <p className="type-small mt-1 text-gray">{t("samples.sentence")}</p>
      <ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2" data-testid="samples">
        {(samples ?? []).map((sample) => (
          <li key={sample.id}>
            <button
              type="button"
              onClick={() => void flow.pickSample(sample)}
              disabled={flow.state.busy !== null}
              data-sample={sample.id}
              className="group block w-full text-left disabled:opacity-60"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- processed sample photograph */}
              <img
                src={sample.photos[0]?.path}
                alt=""
                width={sample.photos[0]?.width}
                height={sample.photos[0]?.height}
                loading="lazy"
                className="aspect-[3/2] w-full rounded object-cover"
              />
              <span className="mt-2 block font-[450] text-ink group-hover:underline">{pt ? sample.title_pt : sample.title}</span>
              <span className="type-small block text-gray">{pt ? sample.story_pt : sample.story}</span>
              <span className="type-label mt-1 block">
                {t("samples.credit", { photographer: sample.credit.photographer, source: sample.credit.source })}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---- details ------------------------------------------------------------------------------

export function DetailsStep({ flow }: { flow: Flow }) {
  const t = useTranslations("Flow");
  const options = useTranslations("Explorer.options");
  const { state } = flow;
  const answer = state.analysis;
  const suggestion = answer?.analysis?.truck;
  const weightId = useId();
  const notesId = useId();
  const ready = Boolean(state.truck && state.totalKg && state.totalKg > 0);

  return (
    <section aria-labelledby="details-title">
      <p className="type-label">{t("steps.details")}</p>
      <h1 id="details-title" className="type-hero mt-4 text-balance">
        {t("details.title")}
      </h1>

      <div className="mt-6 rounded bg-surface p-4" aria-live="polite" data-testid="analysis-status" data-mode={answer?.mode ?? (state.analyzing ? "running" : "none")}>
        {state.analyzing ? (
          <>
            <p className="font-[450] text-ink">{t("analysis.running")}</p>
            <div className="mt-3 h-0.5 w-full overflow-hidden bg-paper" aria-hidden>
              <div className="h-full w-1/3 animate-[indeterminate_1.1s_ease-in-out_infinite] bg-ink" />
            </div>
          </>
        ) : answer?.analysis ? (
          <>
            <p className="font-[450] text-ink">
              {t(answer.mode === "sample" ? "analysis.sample" : answer.mode === "cached" ? "analysis.cached" : "analysis.done", {
                units: answer.analysis.units.length,
              })}
            </p>
            {answer.analysis.summary && <p className="type-small mt-1 text-gray">“{answer.analysis.summary}”</p>}
            {!answer.analysis.is_truck_load && <p className="type-small mt-2 text-fail">{t("analysis.notALoad")}</p>}
          </>
        ) : (
          <p className="text-ink">{t(`analysis.demo.${answer?.reason ?? "failed"}` as never)}</p>
        )}
      </div>

      <fieldset className="mt-10">
        <legend className="type-label">{t("details.body")}</legend>
        <ChipRow
          options={BODIES}
          value={state.truck?.body ?? null}
          suggested={suggestion && suggestion.body !== "unknown" ? suggestion.body : null}
          label={(value) => options(`body.${value}` as never)}
          onChoose={(body) => flow.setTruck({ body: body as Body, size: state.truck?.size ?? "toco" })}
        />
      </fieldset>
      <fieldset className="mt-6">
        <legend className="type-label">{t("details.size")}</legend>
        <ChipRow
          options={SIZES}
          value={state.truck?.size ?? null}
          suggested={suggestion && suggestion.size !== "unknown" ? suggestion.size : null}
          label={(value) => options(`size.${value}` as never)}
          onChoose={(size) => flow.setTruck({ body: state.truck?.body ?? "flatbed", size: size as Size })}
        />
      </fieldset>
      {suggestion && (suggestion.body !== "unknown" || suggestion.size !== "unknown") && (
        <p className="type-small mt-2 text-gray">
          {t("details.suggested", { percent: Math.round(suggestion.confidence * 100) })}
          {suggestion.uncertain && ` ${suggestion.uncertain}`}
        </p>
      )}

      <div className="mt-10">
        <label htmlFor={weightId} className="type-label">
          {t("details.weight")}
        </label>
        <div className="mt-2 flex items-center gap-2">
          <input
            id={weightId}
            type="number"
            inputMode="numeric"
            min={1}
            max={80000}
            step={1}
            required
            value={state.totalKg ?? ""}
            onChange={(event) => flow.setTotal(event.target.value ? Number(event.target.value) : null)}
            className="h-12 w-40 rounded border border-control bg-paper px-3 font-mono text-base"
            data-testid="weight-input"
          />
          <span className="text-gray">kg</span>
        </div>
        <p className="type-small mt-2 text-gray">{t("details.weightWhy")}</p>
        {state.sample && <p className="type-small mt-1 text-gray">{t("details.sampleWeight")}</p>}
      </div>

      <div className="mt-8">
        <label htmlFor={notesId} className="type-label">
          {t("details.notes")}
        </label>
        <textarea
          id={notesId}
          value={state.notes}
          maxLength={2000}
          rows={2}
          onChange={(event) => flow.setNotes(event.target.value)}
          className="mt-2 block w-full max-w-xl rounded border border-control bg-paper px-3 py-2 text-base"
        />
      </div>

      <ErrorLine code={state.error} />
      <div className="mt-8 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={!ready || state.analyzing || state.busy === "draft"}
          onClick={() => void flow.toReview()}
          className={pill({ className: "h-12 px-6" })}
          data-testid="details-next"
        >
          {state.busy === "draft" ? t("details.building") : t("details.next")}
        </button>
        <button type="button" onClick={flow.restart} className={pill({ variant: "secondary", className: "h-12 px-5" })}>
          {t("restart")}
        </button>
      </div>
    </section>
  );
}

function ChipRow({
  options,
  value,
  suggested,
  label,
  onChoose,
}: {
  options: readonly string[];
  value: string | null;
  suggested: string | null;
  label: (value: string) => string;
  onChoose: (value: string) => void;
}) {
  const t = useTranslations("Flow");
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChoose(option)}
          data-option={option}
          className={pill({ variant: value === option ? "primary" : "secondary", className: "h-11 px-4 sm:h-9" })}
        >
          {label(option)}
          {suggested === option && <span className="ml-1.5 text-[0.75rem] opacity-70">· {t("details.ai")}</span>}
        </button>
      ))}
    </div>
  );
}
