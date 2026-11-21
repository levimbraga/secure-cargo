"use client";

/**
 * The driver inspection flow, step by step: photos -> details (truck, weight) -> review (photo
 * and load side by side) -> the seven-situation battery -> the fix.
 *
 * Two ways through it:
 * - **Own photos** (signed in): the Worker stores the photos, analyses them with Claude vision
 *   (quota, cap, cache), runs the battery and the fix on the server and saves everything.
 * - **A sample photo** (anyone): the analysis was computed once and ships with the site. Signed
 *   in, the inspection is saved like any other. Signed out, nothing is saved: the results come
 *   from the site's static files while the load is the sample's, and from the public physics
 *   endpoints once it is edited. With the API down, the unedited sample still runs end to end.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useMe } from "@/components/app/me-provider";
import { AppApiError, useAppApi } from "@/lib/app-api";
import { fetchDraftLoad } from "@/lib/explorer/client";
import type { LoadDraft } from "@/lib/explorer/draft";

import { flowCalls, perceptionDraft, runBattery, runPlan } from "./client";
import { PhotoError, preparePhoto } from "./image";
import { splitWeight, weightsComplete } from "./review";
import { fetchSample, type Sample, type SampleData } from "./samples";
import type { AnalysisAnswer, Battery, Body, PerceptionDraft, Plan, Size } from "./types";

export type Step = "photos" | "details" | "review" | "result";
export type Position = "front" | "left" | "right" | "rear";

export type FlowPhoto = { url: string; position: Position; width: number; height: number; blob?: Blob };

type EditorLoad = { scenario: Battery["scenario"] };

export type FlowState = {
  step: Step;
  sample: SampleData | null;
  inspectionId: string | null;
  photos: FlowPhoto[];
  analysis: AnalysisAnswer | null;
  analyzing: boolean;
  truck: { body: Body; size: Size } | null;
  totalKg: number | null;
  notes: string;
  perception: PerceptionDraft | null;
  draft: LoadDraft | null;
  load: EditorLoad | null;
  /** Fields the user changed or confirmed, per unit id (the rest are the AI's suggestion). */
  confirmed: Record<string, string[]>;
  battery: Battery | null;
  plan: Plan | null;
  busy: "upload" | "draft" | "battery" | "plan" | null;
  startedAt: number | null;
  error: string | null;
};

const INITIAL: FlowState = {
  step: "photos",
  sample: null,
  inspectionId: null,
  photos: [],
  analysis: null,
  analyzing: false,
  truck: null,
  totalKg: null,
  notes: "",
  perception: null,
  draft: null,
  load: null,
  confirmed: {},
  battery: null,
  plan: null,
  busy: null,
  startedAt: null,
  error: null,
};

export const MAX_PHOTOS = 4;
const POSITIONS: Position[] = ["rear", "left", "right", "front"];

function errorCode(cause: unknown): string {
  if (cause instanceof PhotoError) return `photo_${cause.code}`;
  if (cause instanceof AppApiError) return cause.code;
  return "failed";
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function useInspectionFlow() {
  const { signedIn, me, getToken } = useMe();
  const request = useAppApi();
  const calls = useMemo(() => flowCalls(request), [request]);
  const [state, setState] = useState<FlowState>(INITIAL);
  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
  });
  const patch = useCallback((next: Partial<FlowState>) => setState((current) => ({ ...current, ...next })), []);
  const saving = signedIn && Boolean(me?.org || me?.user);

  // ---- photos -------------------------------------------------------------------------------

  async function ensureInspection(sample?: string): Promise<string | null> {
    if (!saving) return null;
    if (latest.current.inspectionId) return latest.current.inspectionId;
    const { id } = await calls.create(sample ? { sample } : {});
    patch({ inspectionId: id });
    return id;
  }

  async function addPhotos(files: File[]) {
    const room = MAX_PHOTOS - latest.current.photos.length;
    if (room <= 0 || latest.current.sample) return;
    patch({ busy: "upload", error: null });
    try {
      const id = await ensureInspection();
      const added: FlowPhoto[] = [];
      for (const file of files.slice(0, room)) {
        const prepared = await preparePhoto(file);
        const position = POSITIONS[latest.current.photos.length + added.length] ?? "rear";
        if (id) await calls.upload(getToken, id, prepared.blob, position);
        added.push({ url: URL.createObjectURL(prepared.blob), position, width: prepared.width, height: prepared.height, blob: prepared.blob });
      }
      patch({ photos: [...latest.current.photos, ...added], busy: null, analysis: null });
    } catch (cause) {
      patch({ busy: null, error: errorCode(cause) });
    }
  }

  function setPosition(index: number, position: Position) {
    patch({ photos: latest.current.photos.map((photo, n) => (n === index ? { ...photo, position } : photo)) });
  }

  async function pickSample(sample: Sample) {
    patch({ ...INITIAL, busy: "upload" });
    try {
      const data = await fetchSample(sample.id);
      const inspectionId = saving ? (await calls.create({ sample: sample.id })).id : null;
      setState({
        ...INITIAL,
        sample: data,
        inspectionId,
        photos: data.photos.map((photo) => ({ url: photo.path, position: photo.position as Position, width: photo.width, height: photo.height })),
        analysis: { mode: "sample", analysis: data.analysis },
        truck: data.truck,
        totalKg: data.weight_kg,
        step: "details",
      });
      // Saved inspections still ask the API, so the analysis is attached to the record.
      if (inspectionId) void calls.analyze(inspectionId).catch(() => undefined);
    } catch (cause) {
      patch({ busy: null, error: errorCode(cause) });
    }
  }

  /** Photos are in: the analysis starts at once and runs while the details are filled in. */
  async function toDetails() {
    patch({ step: "details", error: null });
    const id = latest.current.inspectionId;
    if (!id || latest.current.sample) return;
    patch({ analyzing: true });
    try {
      const answer = await calls.analyze(id);
      const suggested = answer.analysis?.truck;
      const truck =
        latest.current.truck ??
        (suggested && suggested.body !== "unknown" && suggested.size !== "unknown"
          ? { body: suggested.body, size: suggested.size }
          : null);
      patch({ analysis: answer, analyzing: false, truck });
    } catch (cause) {
      patch({ analyzing: false, analysis: { mode: "demo", analysis: null, reason: null }, error: errorCode(cause) });
    }
  }

  // ---- details -> review ----------------------------------------------------------------------

  async function toReview() {
    const { truck, totalKg, analysis, sample } = latest.current;
    if (!truck || !totalKg) return;
    patch({ busy: "draft", error: null });
    try {
      const fromSample =
        sample && same(truck, sample.truck) && totalKg === sample.weight_kg ? sample.perception : null;
      const perception =
        fromSample ??
        (analysis?.analysis
          ? await perceptionDraft(analysis.analysis, truck, { total_kg: totalKg })
          : manualStart(truck, totalKg));
      const draft = perception.draft.units.every((unit) => unit.mass_kg) ? perception.draft : splitWeight(perception.draft, totalKg);
      const load = fromSample && sample ? { scenario: sample.battery.scenario } : (await fetchDraftLoad(draft)).load;
      patch({ perception, draft, load, confirmed: {}, step: "review", busy: null });
    } catch (cause) {
      patch({ busy: null, error: errorCode(cause) });
    }
  }

  // ---- review ---------------------------------------------------------------------------------

  const edits = useRef(0);
  const edit = useCallback(
    (next: LoadDraft, fields?: { unit: string; field: string }[]) => {
      const version = ++edits.current;
      setState((current) => {
        const confirmed = { ...current.confirmed };
        for (const { unit, field } of fields ?? []) confirmed[unit] = [...new Set([...(confirmed[unit] ?? []), field])];
        return { ...current, draft: next, confirmed, battery: null, plan: null };
      });
      // The bed does not change with the load; fetch the built scenario for the units' sizes.
      fetchDraftLoad(next)
        .then(({ load }) => {
          if (version === edits.current) patch({ load });
        })
        .catch(() => undefined);
    },
    [patch],
  );

  const canConfirm = Boolean(state.draft && weightsComplete(state.draft, state.totalKg));

  // ---- battery and fix ------------------------------------------------------------------------

  async function confirm() {
    const { draft, totalKg, inspectionId, sample, notes } = latest.current;
    if (!draft || !totalKg || !weightsComplete(draft, totalKg)) return;
    patch({ busy: "battery", startedAt: Date.now(), error: null, step: "result" });
    try {
      let battery: Battery;
      if (inspectionId) {
        await calls.saveDraft(inspectionId, { draft, cargo_weight_kg: totalKg, notes });
        battery = await calls.simulate(inspectionId);
      } else if (sample && same(draft, sample.perception.draft)) {
        battery = sample.battery;
      } else {
        battery = await runBattery(draft);
      }
      patch({ battery, busy: null, startedAt: null });
    } catch (cause) {
      patch({ busy: null, startedAt: null, error: errorCode(cause) });
    }
  }

  async function applyFix() {
    const { draft, inspectionId, sample } = latest.current;
    if (!draft) return;
    patch({ busy: "plan", startedAt: Date.now(), error: null });
    try {
      let plan: Plan;
      if (inspectionId) plan = await calls.fix(inspectionId);
      else if (sample && same(draft, sample.perception.draft)) plan = sample.plan;
      else plan = await runPlan(draft);
      patch({ plan, busy: null, startedAt: null });
    } catch (cause) {
      patch({ busy: null, startedAt: null, error: errorCode(cause) });
    }
  }

  function goTo(step: Step) {
    patch({ step, error: null });
  }

  function restart() {
    for (const photo of latest.current.photos) if (photo.blob) URL.revokeObjectURL(photo.url);
    setState(INITIAL);
  }

  // Free the photo previews when the page goes away.
  useEffect(
    () => () => {
      for (const photo of latest.current.photos) if (photo.blob) URL.revokeObjectURL(photo.url);
    },
    [],
  );

  return {
    state,
    saving,
    canConfirm,
    allowance: me?.analysis ?? null,
    addPhotos,
    setPosition,
    removePhoto: (index: number) => patch({ photos: latest.current.photos.filter((_, n) => n !== index) }),
    pickSample,
    toDetails,
    setTruck: (truck: { body: Body; size: Size }) => patch({ truck }),
    setTotal: (totalKg: number | null) => patch({ totalKg }),
    setNotes: (notes: string) => patch({ notes }),
    toReview,
    edit,
    confirm,
    applyFix,
    goTo,
    restart,
  };
}

/** No analysis (none allowed, or it failed): one crate at the headboard, to edit by hand. */
function manualStart(truck: { body: Body; size: Size }, totalKg: number): PerceptionDraft {
  return {
    draft: {
      version: 1,
      source: "manual",
      truck,
      trip: { speed_kmh: 80, road: "straight", weather: "dry", event: "emergency_braking" },
      restraint: "top_over",
      units: [{ id: "unit-1", cargo: "crate", x_m: 0, y_m: 0, straps: 2, mass_kg: totalKg }],
    },
    links: [],
    warnings: ["no_units"],
  };
}
