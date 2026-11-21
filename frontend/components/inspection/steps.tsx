"use client";

/**
 * The questions of a new inspection, one per screen: which saved truck, the photos (guided
 * camera, checked on the phone), the truck (size, then body), and the weight.
 */

import { cn } from "cn";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { type ReactNode, useEffect, useId, useState } from "react";

import { pill } from "@/components/ui/pill";
import { Link } from "@/i18n/navigation";
import { fetchSamples, type Sample } from "@/lib/inspection/samples";
import { bodyOptions, SIZE_INFO, sizesOf, stylesOf, type TruckChoice } from "@/lib/inspection/trucks";
import { useMe } from "@/components/app/me-provider";
import { MAX_PHOTOS, type Shot, type useInspectionFlow } from "@/lib/inspection/use-flow";
import { describeSplit, perUnitMatches, withWeights } from "@/lib/inspection/weight";
import { useUnits } from "@/lib/units";

import { GuidedCamera, Silhouette } from "./camera";
import { CountrySwitch } from "./country-switch";
import { TruckArt } from "./truck-art";

type Flow = ReturnType<typeof useInspectionFlow>;

export function ErrorLine({ code }: { code: string | null }) {
  const t = useTranslations("Flow");
  if (!code) return null;
  return (
    <p role="alert" className="type-small mt-3 text-fail">
      {t.has(`errors.${code}` as never) ? t(`errors.${code}` as never) : t("errors.failed")}
    </p>
  );
}

/** A large tappable card: one answer to the question on the screen. */
export function ChoiceCard({
  selected = false,
  onClick,
  children,
  testId,
  badge,
}: {
  selected?: boolean;
  onClick: () => void;
  children: ReactNode;
  testId?: string;
  badge?: string | null;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      data-testid={testId}
      className={`relative flex min-h-[88px] w-full flex-col items-stretch rounded-md border bg-paper p-4 text-left transition-colors hover:border-ink ${
        selected ? "border-ink ring-1 ring-ink" : "border-hairline"
      }`}
    >
      {badge && (
        <span className="absolute top-3 right-3 rounded-full bg-ink px-2 py-0.5 text-[0.75rem] font-medium text-paper">{badge}</span>
      )}
      {children}
    </button>
  );
}

function StepHeader({ label, title, sentence }: { label: string; title: string; sentence?: ReactNode }) {
  return (
    <header>
      <p className="type-label">{label}</p>
      <h1 className="type-hero mt-4 text-balance">{title}</h1>
      {sentence && <p className="type-body mt-3 text-pretty">{sentence}</p>}
    </header>
  );
}

function truckName(t: ReturnType<typeof useTranslations<"Driver">>, truck: Pick<TruckChoice, "size" | "style">): string {
  return t("truck.name", { size: t(`sizes.${truck.size}.name`), body: t(`styles.${truck.style}.short`) });
}

// ---- my trucks ------------------------------------------------------------------------------

export function GarageStep({ flow }: { flow: Flow }) {
  const t = useTranslations("Driver");
  const trucks = flow.state.savedTrucks ?? [];
  return (
    <section aria-labelledby="garage-title" data-testid="garage-step">
      <StepHeader label={t("steps.garage")} title={t("garage.title")} sentence={t("garage.sentence")} />
      <ul className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {trucks.map((truck) => (
          <li key={truck.id}>
            <ChoiceCard onClick={() => flow.pickSaved(truck)} testId="saved-truck">
              <TruckArt size={truck.size} style={truck.style} className="max-h-16 w-auto self-start" />
              <span className="mt-3 block font-[450] text-ink">{truck.nickname || truckName(t, truck)}</span>
              <span className="type-small block text-gray">
                {truckName(t, truck)} · {t("sizes.axles", { count: SIZE_INFO[truck.size].axles })}
              </span>
            </ChoiceCard>
          </li>
        ))}
        <li>
          <ChoiceCard onClick={() => flow.pickSaved(null)} testId="another-truck">
            <span className="block font-[450] text-ink">{t("garage.another")}</span>
            <span className="type-small block text-gray">{t("garage.anotherHint")}</span>
          </ChoiceCard>
        </li>
      </ul>
      <p className="type-small mt-6 text-gray">
        <Link href="/app/trucks" className="underline decoration-1 underline-offset-4">
          {t("garage.manage")}
        </Link>
      </p>
    </section>
  );
}

// ---- photos ---------------------------------------------------------------------------------

const SHOTS: Shot[] = ["side", "rear_three_quarter"];

export function PhotoStep({ flow, signedIn }: { flow: Flow; signedIn: boolean }) {
  const t = useTranslations("Driver");
  const flowT = useTranslations("Flow");
  const { state } = flow;
  const [camera, setCamera] = useState<Shot | null>(null);
  const allowance = flow.allowance;
  const demoMode = allowance?.mode === "demo";
  const busy = state.busy === "upload" || state.busy === "check";
  const reinspecting = Boolean(state.parent);
  // Organization policy: 2 photos (the server refuses a load confirmed with fewer).
  const twoPhotos = Boolean(useMe().me?.org?.policies?.require_two_photos) && !state.sample;

  return (
    <section aria-labelledby="photos-title" data-testid="photo-step">
      <StepHeader
        label={reinspecting ? t("steps.reinspect") : t("steps.photos")}
        title={reinspecting ? t("capture.reinspectTitle") : t("capture.title")}
        sentence={reinspecting ? t("capture.reinspectSentence", { title: state.parent?.title ?? "" }) : t("capture.sentence")}
      />
      {state.truckFixed && state.truck && (
        <p className="type-small mt-3 text-gray" data-testid="photo-truck">
          {t("capture.forTruck", { truck: state.truck.nickname || truckName(t, state.truck) })}
        </p>
      )}

      {signedIn ? (
        <>
          {demoMode && <p className="type-small mt-4 text-fail">{flowT(`photos.demoMode.${allowance?.reason ?? "kill_switch"}`)}</p>}
          <ul className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {SHOTS.map((shot) => {
              const index = state.photos.findIndex((photo) => photo.shot === shot);
              const photo = index >= 0 ? state.photos[index] : undefined;
              return (
                <li key={shot}>
                  <ChoiceCard
                    onClick={() => !busy && !demoMode && setCamera(shot)}
                    selected={Boolean(photo)}
                    testId={`shot-${shot}`}
                    badge={twoPhotos ? t("capture.required") : shot === "side" ? t("capture.enough") : t("capture.recommended")}
                  >
                    {photo ? (
                      // eslint-disable-next-line @next/next/no-img-element -- a local preview of the driver's own photo
                      <img src={photo.url} alt={t("capture.alt", { shot: t(`capture.shots.${shot}.title`) })} className="aspect-[16/9] w-full rounded object-cover" />
                    ) : (
                      <span className="flex aspect-[16/9] w-full items-center justify-center rounded bg-surface p-4 text-gray">
                        <Silhouette shot={shot} className="h-full max-h-24 w-auto" />
                      </span>
                    )}
                    <span className="mt-3 block font-[450] text-ink">{t(`capture.shots.${shot}.title`)}</span>
                    <span className="type-small block text-gray">{photo ? t("capture.retakeHint") : t(`capture.shots.${shot}.card`)}</span>
                  </ChoiceCard>
                  {photo && (
                    <button type="button" onClick={() => flow.removePhoto(index)} className="type-small mt-1 min-h-11 text-gray underline decoration-1 underline-offset-4">
                      {t("capture.remove")}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {twoPhotos && (
            <p className="type-small mt-3 text-ink" data-testid="policy-two-photos">
              {t("capture.policyTwo")}
            </p>
          )}
          <p className="type-small mt-3 text-gray">{flowT("photos.privacy")}</p>
          {busy && (
            <p className="type-small mt-3 text-gray" role="status">
              {state.busy === "check" ? t("capture.checking") : flowT("photos.preparing")}
            </p>
          )}
        </>
      ) : (
        <div className="mt-6 rounded bg-surface p-4">
          <p className="text-ink">{flowT("photos.signIn")}</p>
          <Link href="/app/sign-in" className={pill({ className: "mt-3 h-11 px-4" })}>
            {flowT("photos.signInButton")}
          </Link>
        </div>
      )}

      {state.pending && <QualityPrompt flow={flow} onRetake={(shot) => setCamera(shot)} />}
      <ErrorLine code={state.error} />

      {state.photos.length > 0 && !state.sample && (
        <button
          type="button"
          onClick={() => void flow.toTruck()}
          disabled={busy || (twoPhotos && state.photos.length < 2)}
          className={pill({ className: "mt-8 h-14 w-full px-6 text-base sm:w-auto" })}
          data-testid="photos-next"
        >
          {t("capture.next")}
        </button>
      )}

      {camera && (
        <GuidedCamera
          shot={camera}
          onClose={() => setCamera(null)}
          onPhoto={(file) => {
            setCamera(null);
            void flow.addPhoto(file, camera);
          }}
        />
      )}

      {!reinspecting && <Samples flow={flow} />}
      {state.photos.length < MAX_PHOTOS && null}
    </section>
  );
}

/**
 * A photo waiting for the driver: a failed instant check (why, "Retake" or "Use it anyway"), or,
 * when every check passed, the one-tap question "Is the whole load in the photo?".
 */
function QualityPrompt({ flow, onRetake }: { flow: Flow; onRetake: (shot: Shot) => void }) {
  const t = useTranslations("Driver.capture");
  const pending = flow.state.pending;
  if (!pending) return null;
  const confirm = pending.confirm && pending.issues.length === 0;
  return (
    <div
      role={confirm ? "group" : "alert"}
      aria-labelledby="pending-photo-title"
      className={cn("mt-6 rounded-md border p-4", confirm ? "border-hairline bg-white" : "border-warn bg-warn-tint")}
      data-testid={confirm ? "whole-load-prompt" : "quality-prompt"}
      data-issues={pending.issues.join(",")}
    >
      <div className="flex gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of the driver's own photo */}
        <img src={pending.photo.url} alt="" className={cn("shrink-0 rounded object-cover", confirm ? "h-24 w-36" : "size-20")} />
        <div className="min-w-0">
          <p id="pending-photo-title" className="font-[450] text-ink">
            {confirm ? t("wholeTitle") : t("retakeTitle")}
          </p>
          {confirm ? (
            <p className="type-small mt-1 text-gray">{t("wholeSentence")}</p>
          ) : (
            <ul className="type-small mt-1 text-ink">
              {pending.issues.map((issue) => (
                <li key={issue}>{t(`issues.${issue}`)}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {confirm ? (
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" onClick={flow.keepPending} className={pill({ className: "h-12 px-5" })} data-testid="whole-yes">
            {t("wholeYes")}
          </button>
          <button
            type="button"
            onClick={() => {
              const shot = pending.photo.shot ?? "side";
              flow.discardPending();
              onRetake(shot);
            }}
            className={pill({ variant: "secondary", className: "h-12 px-5" })}
            data-testid="whole-retake"
          >
            {t("wholeRetake")}
          </button>
        </div>
      ) : (
        <QualityButtons flow={flow} onRetake={onRetake} />
      )}
    </div>
  );
}

function QualityButtons({ flow, onRetake }: { flow: Flow; onRetake: (shot: Shot) => void }) {
  const t = useTranslations("Driver.capture");
  const pending = flow.state.pending;
  if (!pending) return null;
  return (
    <>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => {
            const shot = pending.photo.shot ?? "side";
            flow.discardPending();
            onRetake(shot);
          }}
          className={pill({ className: "h-12 px-5" })}
          data-testid="retake"
        >
          {t("retake")}
        </button>
        <button type="button" onClick={flow.keepPending} className={pill({ variant: "secondary", className: "h-12 px-5" })} data-testid="keep-anyway">
          {t("keep")}
        </button>
      </div>
    </>
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

// ---- truck ----------------------------------------------------------------------------------

function AnalysisLine({ flow }: { flow: Flow }) {
  const t = useTranslations("Driver");
  const flowT = useTranslations("Flow");
  const { state, guess } = flow;
  if (state.analyzing) {
    return (
      <div className="mt-4" role="status" data-testid="analysis-status" data-mode="running">
        <p className="type-small text-gray">{t("truck.reading")}</p>
        <div className="mt-2 h-0.5 w-full max-w-xs overflow-hidden bg-surface" aria-hidden>
          <div className="h-full w-1/3 animate-[indeterminate_1.1s_ease-in-out_infinite] bg-ink" />
        </div>
      </div>
    );
  }
  const answer = state.analysis;
  if (answer && !answer.analysis && !state.sample) {
    return (
      <p className="type-small mt-4 text-gray" data-testid="analysis-status" data-mode={answer.mode}>
        {flowT(`analysis.demo.${answer.reason ?? "failed"}` as never)}
      </p>
    );
  }
  if (guess?.size && guess.style) {
    return (
      <p className="mt-4 rounded bg-surface px-3 py-2 text-[0.9375rem] text-ink" data-testid="analysis-status" data-mode={answer?.mode ?? "sample"}>
        {t("truck.looksLike", { truck: truckName(t, { size: guess.size, style: guess.style }) })}
      </p>
    );
  }
  if (answer?.analysis) {
    return (
      <p className="mt-4 rounded bg-surface px-3 py-2 text-[0.9375rem] text-ink" data-testid="analysis-status" data-mode={answer.mode}>
        {t("truck.readNoTruck", { units: answer.analysis.units.length })}
      </p>
    );
  }
  return null;
}

export function TruckStep({ flow }: { flow: Flow }) {
  const t = useTranslations("Driver");
  const format = useFormatter();
  const { state, guess } = flow;
  const stage = state.truckStage;
  const size = state.truck?.size ?? null;
  const style = state.truck?.style ?? guess?.style ?? "open_low_sides";
  const units = useUnits(state.country);

  return (
    <section aria-labelledby="truck-title" data-testid="truck-step" data-stage={stage}>
      {stage === "size" ? (
        <>
          <StepHeader label={t("steps.truck")} title={t("truck.sizeTitle")} sentence={t("truck.sizeSentence")} />
          <CountrySwitch country={state.country} onChange={flow.setCountry} className="mt-6" hint={false} />
          <AnalysisLine flow={flow} />
          <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {sizesOf(state.country).map((option) => (
              <li key={option}>
                <ChoiceCard
                  onClick={() => flow.chooseSize(option)}
                  selected={size === option}
                  testId={`size-${option}`}
                  badge={guess?.size === option ? t("truck.aiPick") : null}
                >
                  <TruckArt
                    size={option}
                    style={stylesOf(option).includes(style) ? style : (stylesOf(option)[0] ?? style)}
                    className="max-h-16 w-auto self-start"
                  />
                  <span className="mt-3 block font-[450] text-ink">{t(`sizes.${option}.name`)}</span>
                  <span className="type-small block text-gray">
                    {SIZE_INFO[option].payloadLb
                      ? t("sizes.lineUs", {
                          axles: SIZE_INFO[option].axles,
                          payload: units.weight(0, { lb: SIZE_INFO[option].payloadLb, metric: false }),
                          bed: units.length(SIZE_INFO[option].bedM),
                        })
                      : t("sizes.line", {
                          axles: SIZE_INFO[option].axles,
                          payload: `${format.number(SIZE_INFO[option].payloadT)} t`,
                        })}
                  </span>
                  <span className="type-small block text-gray">{t(`sizes.${option}.hint`)}</span>
                </ChoiceCard>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <StepHeader label={t("steps.truck")} title={t("truck.bodyTitle")} sentence={t("truck.bodySentence")} />
          <AnalysisLine flow={flow} />
          <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {bodyOptions(size ?? "toco", state.country).map(({ style: option, code }) => (
              <li key={`${option}-${code ?? ""}`}>
                <ChoiceCard
                  onClick={() => flow.chooseStyle(option, code)}
                  selected={state.truck?.style === option && (code === null || state.truck?.body_code === code)}
                  testId={code ? `style-${option}-${code}` : `style-${option}`}
                  badge={guess?.style === option && code !== "XL" ? t("truck.aiPick") : null}
                >
                  <TruckArt size={size ?? "toco"} style={option} code={code} className="max-h-16 w-auto self-start" />
                  <span className="mt-3 block font-[450] text-ink">
                    {t(`styles.${option}.name`)}
                    {code && ` · ${t("truck.code", { code })}`}
                  </span>
                  <span className="type-small block text-gray">{code ? t(`truck.codeHint.${code}`) : t(`styles.${option}.hint`)}</span>
                </ChoiceCard>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => flow.setTruckStage("size")} className="type-small mt-6 min-h-11 text-gray underline decoration-1 underline-offset-4">
            ← {t("truck.backToSize")}
          </button>
        </>
      )}
    </section>
  );
}

// ---- weight ---------------------------------------------------------------------------------

export function WeightStep({ flow, title }: { flow: Flow; title: string }) {
  const t = useTranslations("Driver");
  const { state } = flow;
  const inputId = useId();
  const invoiceId = useId();
  const [mode, setMode] = useState<"type" | "invoice" | "unknown" | null>(
    state.parent
      ? null
      : state.weightSource === "estimated"
        ? "unknown"
        : state.weightSource === "invoice" && !state.sample
          ? "invoice"
          : state.weightSource
            ? "type"
            : null,
  );
  const [perUnitOpen, setPerUnitOpen] = useState(false);
  const measure = useUnits(state.country);
  const kg = (value: number) => measure.mass(value);
  const us = state.country === "US";
  const perception = state.perception;
  const units = perception?.draft.units ?? [];
  const simulated = flow.simulatedKg;
  const split = perception && simulated ? describeSplit(withWeights(perception.draft, simulated, null)) : null;
  const range = state.range;
  const perUnit = state.perUnit ?? {};
  const perUnitValues = units.map((unit) => perUnit[unit.id] ?? null);
  const perUnitSum = perUnitValues.reduce<number>((a, b) => a + (b ?? 0), 0);
  const perUnitOk = !state.perUnit || (simulated ? perUnitMatches(perUnitValues, simulated) : false);
  const invoice = state.invoice;

  return (
    <section aria-labelledby="weight-title" data-testid="weight-step">
      <StepHeader label={t("steps.weight")} title={t("weight.title")} sentence={t("weight.sentence")} />
      {state.truck && (
        <div className="mt-4 flex items-center gap-3">
          <TruckArt size={state.truck.size} style={state.truck.style} className="h-8 w-auto" />
          <span className="type-small text-gray">{state.truck.nickname || truckName(t, state.truck)}</span>
        </div>
      )}

      {state.parent && state.totalKg && !mode && (
        <p className="mt-6 rounded bg-surface px-3 py-2 text-ink" data-testid="weight-same">
          {t("weight.same", { weight: kg(state.totalKg), source: t(`weight.sources.${state.weightSource ?? "measured"}`) })}
        </p>
      )}
      <ul className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <li>
          <ChoiceCard selected={mode === "type"} onClick={() => setMode("type")} testId="weight-type">
            <span className="block font-[450] text-ink">{t("weight.type")}</span>
            <span className="type-small block text-gray">{t("weight.typeHint", { unit: measure.weightUnit })}</span>
          </ChoiceCard>
        </li>
        <li>
          <ChoiceCard selected={mode === "invoice"} onClick={() => setMode("invoice")} testId="weight-invoice">
            <span className="block font-[450] text-ink">{t("weight.invoice")}</span>
            <span className="type-small block text-gray">{t("weight.invoiceHint")}</span>
          </ChoiceCard>
        </li>
        <li>
          <ChoiceCard
            selected={mode === "unknown"}
            onClick={() => {
              setMode("unknown");
              if (range) flow.setWeight("estimated", range.high_kg);
            }}
            testId="weight-unknown"
          >
            <span className="block font-[450] text-ink">{t("weight.unknown")}</span>
            <span className="type-small block text-gray">{t("weight.unknownHint")}</span>
          </ChoiceCard>
        </li>
      </ul>

      {mode === "type" && (
        <div className="mt-6">
          <label htmlFor={inputId} className="type-label">
            {t("weight.kgLabel")}
          </label>
          <div className="mt-2 flex items-center gap-2">
            <input
              id={inputId}
              type="number"
              inputMode="numeric"
              min={1}
              max={us ? 176000 : 80000}
              autoFocus
              value={
                state.weightSource === "measured" || (state.weightSource === "invoice" && state.sample)
                  ? state.totalKg
                    ? Math.round(measure.weightOut(state.totalKg))
                    : ""
                  : ""
              }
              onChange={(event) =>
                flow.setWeight("measured", event.target.value ? Math.round(measure.weightIn(Number(event.target.value)) * 10) / 10 : null)
              }
              className="h-14 w-48 rounded border border-control bg-paper px-3 font-mono text-lg"
              data-testid="weight-input"
            />
            <span className="text-gray">{measure.weightUnit}</span>
          </div>
          {state.sample && state.weightSource === "invoice" && <p className="type-small mt-2 text-gray">{t("weight.sampleInvoice", { weight: kg(state.sample.weight_kg) })}</p>}
        </div>
      )}

      {mode === "invoice" && (
        <div className="mt-6 rounded-md bg-surface p-4" data-testid="invoice-panel">
          {state.sample ? (
            <p className="text-ink">{t("weight.sampleInvoice", { weight: kg(state.sample.weight_kg) })}</p>
          ) : invoice.busy ? (
            <p className="text-ink" role="status">
              {t("weight.invoiceReading")}
            </p>
          ) : invoice.grossKg !== null ? (
            <>
              <p className="font-[450] text-ink" data-testid="invoice-reading">
                {t("weight.invoiceSays", { weight: kg(invoice.grossKg) })}
              </p>
              <p className="type-small mt-1 text-gray">{t("weight.invoiceText", { text: invoice.text ?? "" })}</p>
              <div className="mt-4 flex flex-wrap gap-3">
                <button type="button" onClick={() => flow.setWeight("invoice", invoice.grossKg)} className={pill({ className: "h-12 px-5" })} data-testid="invoice-confirm">
                  {state.weightSource === "invoice" && state.totalKg === invoice.grossKg ? t("weight.invoiceUsed") : t("weight.invoiceConfirm")}
                </button>
                <button type="button" onClick={() => setMode("type")} className={pill({ variant: "secondary", className: "h-12 px-5" })}>
                  {t("weight.typeInstead")}
                </button>
              </div>
            </>
          ) : (
            <>
              {invoice.tried && <p className="mb-3 text-ink">{invoice.error === "demo_mode" ? t("weight.invoiceDemo") : t("weight.invoiceNotFound")}</p>}
              <label htmlFor={invoiceId} className={pill({ className: "h-12 cursor-pointer px-5" })}>
                {t("weight.invoicePhoto")}
              </label>
              <input
                id={invoiceId}
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void flow.readInvoice(file);
                  event.target.value = "";
                }}
              />
              <p className="type-small mt-3 text-gray">{t("weight.invoiceWhy")}</p>
            </>
          )}
        </div>
      )}

      {mode === "unknown" && (
        <div className="mt-6 rounded-md border border-warn bg-warn-tint p-4" data-testid="estimate-panel">
          {range ? (
            <>
              <p className="font-[450] text-ink">{t("weight.estimate", { low: kg(range.low_kg), high: kg(range.high_kg) })}</p>
              <p className="type-small mt-1 text-ink">{t("weight.estimateWhy", { high: kg(range.high_kg) })}</p>
            </>
          ) : (
            <p className="text-ink">{t("weight.estimateWaiting")}</p>
          )}
        </div>
      )}

      {split && simulated && (
        <div className="mt-8" data-testid="weight-split">
          <p className="text-ink">
            {split.kind === "equal"
              ? t("weight.splitEqual", { each: kg(split.each), count: split.count })
              : t("weight.splitVaried", { min: kg(split.min), max: kg(split.max), count: split.count })}
          </p>
          {units.length > 1 && (
            <button
              type="button"
              onClick={() => {
                setPerUnitOpen(!perUnitOpen);
                if (perUnitOpen) flow.setPerUnit(null);
              }}
              aria-expanded={perUnitOpen}
              className="type-small mt-1 min-h-11 text-ink underline decoration-1 underline-offset-4"
            >
              {t("weight.different")}
            </button>
          )}
          {perUnitOpen && (
            <div className="mt-2 rounded-md border border-hairline p-4">
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {units.map((unit, index) => (
                  <li key={unit.id}>
                    <label className="type-small block text-gray" htmlFor={`${inputId}-${unit.id}`}>
                      {t("weight.unit", { number: index + 1 })}
                    </label>
                    <input
                      id={`${inputId}-${unit.id}`}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      value={perUnit[unit.id] ?? ""}
                      onChange={(event) => {
                        const next = { ...perUnit };
                        if (event.target.value) next[unit.id] = Number(event.target.value);
                        else delete next[unit.id];
                        flow.setPerUnit(next);
                      }}
                      className="mt-1 h-11 w-full rounded border border-control bg-paper px-2 font-mono"
                    />
                  </li>
                ))}
              </ul>
              <p className={`type-small mt-3 ${perUnitOk ? "text-gray" : "text-fail"}`} role="status">
                {t("weight.perUnitSum", { sum: kg(perUnitSum), total: kg(simulated) })}
              </p>
            </div>
          )}
        </div>
      )}

      <ErrorLine code={state.error} />
      <button
        type="button"
        disabled={!flow.canSimulate || !perUnitOk || state.busy === "battery"}
        onClick={() => void flow.toResult(title)}
        className={pill({ className: "mt-10 h-14 w-full px-6 text-base sm:w-auto" })}
        data-testid="weight-next"
      >
        {!perception ? t("weight.waitingForPhoto") : t("weight.next")}
      </button>
    </section>
  );
}
