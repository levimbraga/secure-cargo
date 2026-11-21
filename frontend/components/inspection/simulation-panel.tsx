"use client";

/**
 * "Open the simulation": the load in 3D in one situation of the battery (the worst one first),
 * with the force arrows and the reason in one sentence, and four simple choices (road, weather,
 * speed, event) to see what changes and why.
 *
 * As long as the trip is one of the battery's, the stored server run is replayed (no API needed;
 * a sample works offline). A changed choice runs the load live in the browser (MuJoCo
 * WebAssembly, through the explorer's runner), "live, not certified".
 */

import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { ExplorerScene } from "@/components/explorer/explorer-scene";
import { useReasonSentence } from "@/components/lab/lab-result";
import { Findings } from "@/components/scenario/replay-shared";
import { pill } from "@/components/ui/pill";
import { VerdictBadge } from "@/components/ui/verdict-badge";
import { Link } from "@/i18n/navigation";
import type { ExplorerEvent, Road, Weather } from "@/lib/explorer/config";
import { encodeDraft, type LoadDraft } from "@/lib/explorer/draft";
import { type ExplorerRun, useExplorer } from "@/lib/explorer/use-explorer";
import { parseKeyframes } from "@/lib/keyframes";
import type { LiveRun } from "@/lib/live/engine";
import { explain } from "@/lib/live/reason";
import { simulateSituation } from "@/lib/inspection/client";
import { fetchSampleRun } from "@/lib/inspection/samples";
import { type Battery, SITUATION_IDS, type ServerRunResult, type SituationId } from "@/lib/inspection/types";

const ROADS: Road[] = ["straight", "curvy", "mountain", "dirt", "potholed", "urban"];
const WEATHERS: Weather[] = ["dry", "wet", "heavy_rain", "mud", "fog"];
const EVENTS: ExplorerEvent[] = ["emergency_braking", "lane_change", "sharp_curve", "pothole", "speed_bump", "mountain_descent", "long_vibration"];

export function toRun(result: ServerRunResult): ExplorerRun {
  const doc = parseKeyframes(result.keyframes);
  return { source: "server", summary: result, doc, reason: explain(result, doc), runMs: 0 };
}

function Chips<T extends string>({ label, options, value, name, onChoose }: { label: string; options: readonly T[]; value: T; name: (v: T) => string; onChoose: (v: T) => void }) {
  return (
    <fieldset className="mt-4">
      <legend className="type-label">{label}</legend>
      <div className="mt-2 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={value === option}
            onClick={() => onChoose(option)}
            data-option={option}
            className={pill({ variant: value === option ? "primary" : "secondary", className: "h-11 shrink-0 px-4" })}
          >
            {name(option)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

type Trip = LoadDraft["trip"];

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
  const options = useTranslations("Explorer.options");
  const lab = useTranslations("Lab");
  const flow = useTranslations("Flow");
  const format = useFormatter();
  const situationOf = (id: SituationId) => battery.situations.find((s) => s.id === id) ?? battery.situations[0];
  const [chosen, setChosen] = useState<SituationId>(initial);
  const [trip, setTrip] = useState<Trip>(() => situationOf(initial)?.trip ?? battery.draft.trip);
  const [speed, setSpeed] = useState<number | null>(null);
  const battle = SITUATION_IDS.find((id) => {
    const s = battery.situations.find((item) => item.id === id);
    return s && JSON.stringify(s.trip) === JSON.stringify(trip);
  });
  const set = (patch: Partial<Trip>) => {
    const next = { ...trip, ...patch };
    setTrip(next);
    const match = battery.situations.find((s) => JSON.stringify(s.trip) === JSON.stringify(next));
    if (match) setChosen(match.id);
  };

  return (
    <section className="mt-6 rounded-md border border-hairline p-4 sm:p-6" aria-labelledby="sim-title" data-testid="simulation-panel" data-situation={battle ?? "custom"}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="type-label">{t("label")}</p>
          <h2 id="sim-title" className="type-card-title mt-2">
            {battle ? flow(`situations.${battle}.name`) : t("custom")}
          </h2>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} className="type-small min-h-11 text-gray underline decoration-1 underline-offset-4">
            {t("close")}
          </button>
        )}
      </div>

      <div className="mt-2 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]" role="group" aria-label={t("situations")}>
        {SITUATION_IDS.map((id) => {
          const s = battery.situations.find((item) => item.id === id);
          if (!s) return null;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={battle === id}
              onClick={() => {
                setChosen(id);
                setTrip(s.trip);
              }}
              className={pill({ variant: battle === id ? "primary" : "secondary", className: "h-10 shrink-0 px-3" })}
              data-sim-situation={id}
            >
              <span aria-hidden className={`mr-1.5 inline-block size-2 rounded-full ${s.status === "fail" ? "bg-fail" : s.status === "warning" ? "bg-amber" : "bg-pass"}`} />
              {flow(`situations.${id}.name`)}
            </button>
          );
        })}
      </div>

      {battle ? (
        <StoredRun key={battle} battery={battery} situation={chosen} staticRun={staticRuns?.[chosen]} />
      ) : (
        <LiveRunView key={JSON.stringify(trip)} draft={{ ...battery.draft, trip }} />
      )}

      <div className="mt-6">
        <Chips label={t("road")} options={ROADS} value={trip.road} name={(v) => options(`road.${v}` as never)} onChoose={(road) => set({ road })} />
        <Chips label={t("weather")} options={WEATHERS} value={trip.weather} name={(v) => options(`weather.${v}` as never)} onChoose={(weather) => set({ weather })} />
        <div className="mt-4">
          <label className="type-label flex items-center justify-between" htmlFor="sim-speed">
            <span>{t("speed")}</span>
            <output className="font-mono text-ink">{format.number(speed ?? trip.speed_kmh)} km/h</output>
          </label>
          <input
            id="sim-speed"
            type="range"
            min={20}
            max={100}
            step={10}
            value={speed ?? trip.speed_kmh}
            onChange={(event) => setSpeed(Number(event.target.value))}
            onPointerUp={() => speed !== null && (set({ speed_kmh: speed }), setSpeed(null))}
            onKeyUp={() => speed !== null && (set({ speed_kmh: speed }), setSpeed(null))}
            className="mt-2 block h-11 w-full accent-ink"
          />
        </div>
        <Chips label={t("event")} options={EVENTS} value={trip.event as ExplorerEvent} name={(v) => lab(`events.${v}` as never)} onChoose={(event) => set({ event })} />
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link href={`/app/explorer#draft=${encodeDraft({ ...battery.draft, trip })}`} className={pill({ variant: "secondary", className: "h-11 px-4" })}>
          {t("explorer")}
        </Link>
      </div>
    </section>
  );
}

function Verdict({ run }: { run: ExplorerRun | null }) {
  const t = useTranslations("Driver.sim");
  const sentence = useReasonSentence();
  const status = run?.summary.verdict.status;
  return (
    <div className="mt-4" aria-live="polite">
      {run && status ? (
        <VerdictBadge verdict={status === "fail" ? "fail" : status === "warning" ? "warn" : "pass"}>{t(`status.${status}`)}</VerdictBadge>
      ) : (
        <VerdictBadge verdict="neutral">{t("running")}</VerdictBadge>
      )}
      <p className="type-card-title mt-3 min-h-[2.4em] text-pretty" data-testid="situation-reason">
        {run ? sentence(run.reason) : ""}
      </p>
    </div>
  );
}

/** The battery's own run of a situation: the stored one, or the server's (cached) one. */
function StoredRun({ battery, situation, staticRun }: { battery: Battery; situation: SituationId; staticRun?: string }) {
  const t = useTranslations("Driver.sim");
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
  return (
    <>
      <Verdict run={run} />
      {failed && <p className="type-small text-gray">{t("unavailable")}</p>}
      <div className="mt-4">
        <ExplorerScene run={run} engine={engine} busy={!run} event={s?.event.kind ?? "emergency_braking"} />
      </div>
      {run && <Findings run={run.summary} />}
      <p className="type-label mt-3">{t("server")}</p>
    </>
  );
}

/** A trip of the driver's choice: simulated live in the browser. */
function LiveRunView({ draft }: { draft: LoadDraft }) {
  const t = useTranslations("Driver.sim");
  const explorer = useExplorer({ kind: "draft", draft });
  return (
    <>
      <Verdict run={explorer.busy ? null : explorer.run} />
      {explorer.error && <p className="type-small text-fail">{t("unavailable")}</p>}
      <div className="mt-4">
        <ExplorerScene run={explorer.run} engine={explorer.engine} busy={explorer.busy} event={explorer.load?.event.kind ?? draft.trip.event} />
      </div>
      {explorer.run && !explorer.busy && <Findings run={explorer.run.summary} />}
      <p className="type-label mt-3">{t("live")}</p>
    </>
  );
}
