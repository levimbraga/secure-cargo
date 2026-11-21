"use client";

/**
 * The driver inspection flow, one question per screen:
 *
 *   (my trucks) -> photos -> truck (size, then body) -> weight -> result
 *
 * The photo analysis starts as soon as the photos are in and runs while the driver answers the
 * truck and weight questions; there is no review step: the result comes straight away, with a
 * one-line summary of what was read and "Wrong reading? Correct it" (the editor, `edit`).
 *
 * Two ways through it:
 * - **Own photos** (signed in): the Worker stores the photos, analyses them with Claude vision
 *   (quota, cap, cache), runs the battery and the fix on the server and saves everything.
 * - **A sample photo** (anyone): the analysis was computed once and ships with the site. Signed
 *   in, the inspection is saved like any other. Signed out, nothing is saved: the results come
 *   from the site's static files while the load is the sample's, and from the public physics
 *   endpoints once it is changed. With the API down, the unchanged sample still runs end to end.
 *
 * A **re-inspection** ("I fixed it: take a new photo") starts from a saved inspection: the same
 * truck and weight, a new photo, and a new inspection linked to the first.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useMe } from "@/components/app/me-provider";
import { AppApiError, type InspectionDetail, useAppApi } from "@/lib/app-api";
import { fetchDraftLoad } from "@/lib/explorer/client";
import type { LoadDraft } from "@/lib/explorer/draft";

import { flowCalls, perceptionDraft, runBattery, runPlan } from "./client";
import { PhotoError, preparePhoto } from "./image";
import { checkBlob, CONFIRM_WHOLE, type QualityIssue } from "./photo-quality";
import { weightsComplete } from "./review";
import { fetchSample, type Sample, type SampleData } from "./samples";
import { choiceOf, draftTruck, type SavedTruck, sizeOfGuess, styleOfGuess, type TruckChoice } from "./trucks";
import type { AnalysisAnswer, Battery, PerceptionDraft, Plan } from "./types";
import { verdictOf } from "./verdict";
import { estimateRange, simulatedWeight, type WeightRange, type WeightSource, withWeights } from "./weight";

export type Step = "garage" | "photos" | "truck" | "weight" | "result" | "edit";
export type Shot = "side" | "rear_three_quarter";
export type Position = "front" | "left" | "right" | "rear";

export type FlowPhoto = {
  url: string;
  position: Position;
  shot: Shot | null;
  width: number;
  height: number;
  blob?: Blob;
};

/** A photo that did not pass the instant checks: the driver retakes it or keeps it. */
/** A photo waiting for the driver: a failed check ("retake?"), or the whole-load question. */
export type PendingPhoto = { photo: FlowPhoto; issues: QualityIssue[]; confirm?: boolean };

type EditorLoad = { scenario: Battery["scenario"] };

export type InvoiceState = { busy: boolean; grossKg: number | null; text: string | null; tried: boolean; error: string | null };

export type FlowState = {
  step: Step;
  truckStage: "size" | "body";
  sample: SampleData | null;
  inspectionId: string | null;
  /** The inspection this one re-checks, with its truck, weight and result for the before/after. */
  parent: { id: string; title: string; battery: Battery | null } | null;
  photos: FlowPhoto[];
  pending: PendingPhoto | null;
  analysis: AnalysisAnswer | null;
  analyzing: boolean;
  savedTrucks: SavedTruck[] | null;
  truck: TruckChoice | null;
  /** The truck came from "My trucks" or a re-inspection: the truck questions are skipped. */
  truckFixed: boolean;
  weightSource: WeightSource | null;
  totalKg: number | null;
  range: WeightRange | null;
  perUnit: Record<string, number> | null;
  invoice: InvoiceState;
  notes: string;
  perception: PerceptionDraft | null;
  draft: LoadDraft | null;
  load: EditorLoad | null;
  /** Fields the user changed or confirmed, per unit id (the rest are the AI's suggestion). */
  confirmed: Record<string, string[]>;
  battery: Battery | null;
  plan: Plan | null;
  busy: "upload" | "check" | "draft" | "battery" | "plan" | "share" | null;
  startedAt: number | null;
  error: string | null;
  shareUrl: string | null;
};

const NO_INVOICE: InvoiceState = { busy: false, grossKg: null, text: null, tried: false, error: null };

const INITIAL: FlowState = {
  step: "photos",
  truckStage: "size",
  sample: null,
  inspectionId: null,
  parent: null,
  photos: [],
  pending: null,
  analysis: null,
  analyzing: false,
  savedTrucks: null,
  truck: null,
  truckFixed: false,
  weightSource: null,
  totalKg: null,
  range: null,
  perUnit: null,
  invoice: NO_INVOICE,
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
  shareUrl: null,
};

export const MAX_PHOTOS = 2;
const SHOT_POSITION: Record<Shot, Position> = { side: "left", rear_three_quarter: "rear" };

function errorCode(cause: unknown): string {
  if (cause instanceof PhotoError) return `photo_${cause.code}`;
  if (cause instanceof AppApiError) return cause.code;
  return "failed";
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The sample's precomputed results still apply: same physics truck and the same weight. */
function sampleApplies(sample: SampleData | null, truck: TruckChoice | null, totalKg: number | null): boolean {
  if (!sample || !truck) return false;
  const physics = draftTruck(truck);
  return (
    physics.body === sample.truck.body &&
    physics.size === sample.truck.size &&
    !truck.bed_length_m &&
    !truck.headboard_height_m &&
    !truck.anchors_per_side &&
    totalKg === sample.weight_kg
  );
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
  // Signed in, everything is saved; this must not wait for /me (a photo can come first).
  const saving = signedIn;

  // ---- my trucks ----------------------------------------------------------------------------

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    request<{ trucks: SavedTruck[] }>("/trucks")
      .then(({ trucks }) => {
        if (cancelled) return;
        setState((current) => {
          // Saved trucks are asked about first, before the photo (unless the flow moved on).
          const first = trucks.length > 0 && current.step === "photos" && current.photos.length === 0 && !current.sample && !current.parent;
          return { ...current, savedTrucks: trucks, ...(first ? { step: "garage" as const } : {}) };
        });
      })
      .catch(() => !cancelled && patch({ savedTrucks: [] }));
    return () => {
      cancelled = true;
    };
  }, [signedIn, request, patch]);

  function pickSaved(saved: SavedTruck | null) {
    if (!saved) {
      patch({ step: "photos", truckFixed: false });
      return;
    }
    patch({ truck: { ...saved, truck_id: saved.id, nickname: saved.nickname }, truckFixed: true, step: "photos" });
  }

  async function saveTruck(choice: TruckChoice, nickname: string): Promise<SavedTruck | null> {
    if (!saving) return null;
    try {
      const saved = await request<SavedTruck>("/trucks", {
        method: "POST",
        body: JSON.stringify({
          nickname,
          size: choice.size,
          style: choice.style,
          bed_length_m: choice.bed_length_m ?? undefined,
          headboard_height_m: choice.headboard_height_m ?? undefined,
          anchors_per_side: choice.anchors_per_side ?? undefined,
        }),
      });
      patch({ savedTrucks: [saved, ...(latest.current.savedTrucks ?? [])], truck: { ...choice, truck_id: saved.id, nickname } });
      return saved;
    } catch {
      return null;
    }
  }

  // ---- photos -------------------------------------------------------------------------------

  async function ensureInspection(): Promise<string | null> {
    if (!saving) return null;
    if (latest.current.inspectionId) return latest.current.inspectionId;
    const parent = latest.current.parent;
    const { id } = await calls.create(parent ? { reinspection_of: parent.id, title: parent.title } : {});
    patch({ inspectionId: id });
    return id;
  }

  /** A new photo: checked on the phone first; only a photo that passes (or is kept) is sent. */
  async function addPhoto(file: File, shot: Shot | null) {
    if (latest.current.photos.length >= MAX_PHOTOS || latest.current.sample) return;
    patch({ busy: "check", error: null });
    try {
      const prepared = await preparePhoto(file);
      const photo: FlowPhoto = {
        url: URL.createObjectURL(prepared.blob),
        position: shot ? SHOT_POSITION[shot] : "left",
        shot,
        width: prepared.width,
        height: prepared.height,
        blob: prepared.blob,
      };
      const report = await checkBlob(prepared.blob).catch(() => ({ issues: [] as QualityIssue[] }));
      if (report.issues.length) {
        patch({ busy: null, pending: { photo, issues: report.issues } });
        return;
      }
      // Pixels cannot always tell a cut-off load from a busy background: the driver confirms.
      if (CONFIRM_WHOLE) {
        patch({ busy: null, pending: { photo, issues: [], confirm: true } });
        return;
      }
      await keep(photo);
    } catch (cause) {
      patch({ busy: null, error: errorCode(cause) });
    }
  }

  async function keep(photo: FlowPhoto) {
    patch({ busy: "upload", pending: null, error: null });
    try {
      const id = await ensureInspection();
      if (id && photo.blob) await calls.upload(getToken, id, photo.blob, photo.position);
      patch({ photos: [...latest.current.photos.filter((p) => !photo.shot || p.shot !== photo.shot), photo], busy: null, analysis: null });
    } catch (cause) {
      patch({ busy: null, error: errorCode(cause) });
    }
  }

  function keepPending() {
    const pending = latest.current.pending;
    if (pending) void keep(pending.photo);
  }

  function discardPending() {
    const pending = latest.current.pending;
    if (pending?.photo.blob) URL.revokeObjectURL(pending.photo.url);
    patch({ pending: null });
  }

  function removePhoto(index: number) {
    const photo = latest.current.photos[index];
    if (photo?.blob) URL.revokeObjectURL(photo.url);
    patch({ photos: latest.current.photos.filter((_, n) => n !== index), analysis: null });
  }

  async function pickSample(sample: Sample) {
    patch({ ...INITIAL, savedTrucks: latest.current.savedTrucks, busy: "upload" });
    try {
      const data = await fetchSample(sample.id);
      const inspectionId = saving ? (await calls.create({ sample: sample.id, title: sample.title })).id : null;
      setState((current) => ({
        ...INITIAL,
        savedTrucks: current.savedTrucks,
        sample: data,
        inspectionId,
        photos: data.photos.map((photo) => ({
          url: photo.path,
          position: photo.position as Position,
          shot: photo.position === "rear" ? "rear_three_quarter" : "side",
          width: photo.width,
          height: photo.height,
        })),
        analysis: { mode: "sample", analysis: data.analysis },
        step: "truck",
      }));
      // Saved inspections still ask the API, so the analysis is attached to the record.
      if (inspectionId) void calls.analyze(inspectionId).catch(() => undefined);
    } catch (cause) {
      patch({ busy: null, error: errorCode(cause) });
    }
  }

  /** Photos are in: the analysis starts at once and runs while the truck and weight are asked. */
  async function toTruck() {
    const { truckFixed, inspectionId: known, sample: chosen } = latest.current;
    patch({ step: truckFixed ? "weight" : "truck", truckStage: "size", error: null, perception: null });
    // Without an analysis to wait for, the load is ready now; else once the photo is read.
    if (truckFixed && (!known || chosen)) void buildPerception();
    const id = latest.current.inspectionId;
    if (!id || latest.current.sample) return;
    patch({ analyzing: true });
    let answer: AnalysisAnswer;
    try {
      answer = await calls.analyze(id);
      patch({ analysis: answer, analyzing: false });
    } catch (cause) {
      answer = { mode: "demo", analysis: null, reason: null };
      patch({ analyzing: false, analysis: answer, error: errorCode(cause) });
    }
    if (latest.current.step === "weight") void buildPerception(answer);
  }

  // ---- truck --------------------------------------------------------------------------------

  /** The AI's guess, when there is one (a sample's truck is its known one). */
  const guess = useMemo((): Partial<TruckChoice> | null => {
    if (state.sample) {
      const truck = state.sample.truck;
      return { size: sizeOfGuess(truck.size) ?? undefined, style: truck.style ?? styleOfGuess(truck.body) ?? undefined };
    }
    const truck = state.analysis?.analysis?.truck;
    if (!truck) return null;
    const size = sizeOfGuess(truck.size);
    const style = styleOfGuess(truck.body);
    return size || style ? { size: size ?? undefined, style: style ?? undefined } : null;
  }, [state.sample, state.analysis]);

  function chooseSize(size: TruckChoice["size"]) {
    const current = latest.current.truck;
    patch({ truck: { style: current?.style ?? guess?.style ?? "open_low_sides", ...current, size, truck_id: null }, truckStage: "body" });
  }

  function chooseStyle(style: TruckChoice["style"]) {
    const current = latest.current.truck;
    patch({ truck: { size: current?.size ?? guess?.size ?? "toco", ...current, style, truck_id: null }, step: "weight" });
    void buildPerception();
  }

  // ---- weight -------------------------------------------------------------------------------

  /** The load as the photo shows it on the chosen truck, without weights (for the split). */
  async function buildPerception(read?: AnalysisAnswer): Promise<PerceptionDraft | null> {
    const { truck, sample, parent, analyzing } = latest.current;
    const analysis = read ?? latest.current.analysis;
    // The photo is still being read: the load is built once it is (see toTruck).
    if (!truck || (analyzing && !read)) return null;
    patch({ busy: latest.current.busy ?? "draft" });
    try {
      let perception: PerceptionDraft;
      if (sample && sampleApplies(sample, truck, sample.weight_kg)) perception = sample.perception;
      else if (analysis?.analysis) perception = await perceptionDraft(analysis.analysis, draftTruck(truck), null);
      else if (parent?.battery) perception = { draft: { ...parent.battery.draft, truck: draftTruck(truck) }, links: [], warnings: [] };
      else perception = manualStart(draftTruck(truck));
      const range = estimateRange(perception.draft);
      patch({ perception, range, busy: latest.current.busy === "draft" ? null : latest.current.busy });
      // A sample comes with its (made-up) invoice weight.
      if (sample && latest.current.weightSource === null) patch({ weightSource: "invoice", totalKg: sample.weight_kg });
      return perception;
    } catch (cause) {
      patch({ busy: null, error: errorCode(cause) });
      return null;
    }
  }

  async function readInvoice(file: File) {
    patch({ invoice: { ...NO_INVOICE, busy: true, tried: true }, error: null });
    try {
      const prepared = await preparePhoto(file);
      const id = await ensureInspection();
      if (!id) throw new AppApiError(401, "sign_in_required", "Sign in to read an invoice.");
      const token = await getToken();
      const { API_URL } = await import("@/lib/api");
      const response = await fetch(`${API_URL}/inspections/${encodeURIComponent(id)}/invoice`, {
        method: "POST",
        headers: { "Content-Type": "image/jpeg", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        credentials: "include",
        body: prepared.blob,
      });
      if (!response.ok) throw new AppApiError(response.status, "invoice_failed", "The invoice could not be read.");
      const answer = (await response.json()) as { mode: string; reading: { gross_kg: number | null; text: string } | null };
      patch({
        invoice: {
          busy: false,
          grossKg: answer.reading?.gross_kg ?? null,
          text: answer.reading?.text ?? null,
          tried: true,
          error: answer.mode === "demo" ? "demo_mode" : null,
        },
      });
    } catch (cause) {
      patch({ invoice: { ...NO_INVOICE, tried: true, error: errorCode(cause) } });
    }
  }

  function setWeight(source: WeightSource, totalKg: number | null) {
    patch({ weightSource: source, totalKg, perUnit: null });
  }

  const simulatedKg = simulatedWeight(state.weightSource ?? "measured", state.totalKg, state.range);
  const canSimulate = Boolean(state.truck && simulatedKg && state.perception);

  // ---- result -------------------------------------------------------------------------------

  /** `title`: what the lists show, e.g. "3 × Steel pipe" (written in the user's language). */
  async function toResult(title?: string) {
    const { perception, truck, weightSource, totalKg, range, perUnit, sample } = latest.current;
    const kg = simulatedWeight(weightSource ?? "measured", totalKg, range);
    if (!perception || !truck || !kg) return;
    // An unchanged sample keeps its own weights, so its stored results still apply.
    const asSample = sample && !perUnit && sampleApplies(sample, truck, kg) && same(perception.draft.units.map((u) => u.id), sample.perception.draft.units.map((u) => u.id));
    const draft = asSample
      ? { ...sample.perception.draft, truck: draftTruck(truck) }
      : withWeights({ ...perception.draft, truck: draftTruck(truck) }, kg, perUnit);
    patch({ draft, confirmed: {}, plan: null });
    fetchDraftLoad(draft)
      .then(({ load }) => patch({ load }))
      .catch(() => undefined);
    await simulate(draft, kg, title);
  }

  async function simulate(draft: LoadDraft, kg: number, title?: string) {
    const { inspectionId, sample, notes, weightSource, range, truck } = latest.current;
    patch({ draft, busy: "battery", startedAt: Date.now(), error: null, step: "result", battery: null, plan: null, shareUrl: null });
    try {
      let battery: Battery;
      if (inspectionId) {
        await calls.saveDraft(inspectionId, {
          draft,
          cargo_weight_kg: kg,
          notes,
          title,
          weight_source: weightSource ?? "measured",
          weight_range: weightSource === "estimated" ? range : undefined,
          truck_id: truck?.truck_id ?? undefined,
          // What the AI read (on the confirmed truck): the audit trail shows what the driver changed.
          prefill: latest.current.perception?.draft ?? undefined,
        });
        battery = await calls.simulate(inspectionId);
      } else if (sample && same(draft.units, sample.perception.draft.units) && sampleApplies(sample, truck, kg)) {
        battery = sample.battery;
      } else {
        battery = await runBattery(draft);
      }
      patch({ battery, busy: null, startedAt: null });
      // Not approved: the smallest fix is found and proven straight away.
      if (verdictOf(battery).state !== "approved") void applyFix(draft);
    } catch (cause) {
      patch({ busy: null, startedAt: null, error: errorCode(cause) });
    }
  }

  // ---- correct the reading (the editor) ------------------------------------------------------

  const edits = useRef(0);
  const edit = useCallback(
    (next: LoadDraft, fields?: { unit: string; field: string }[]) => {
      const version = ++edits.current;
      setState((current) => {
        const confirmed = { ...current.confirmed };
        for (const { unit, field } of fields ?? []) confirmed[unit] = [...new Set([...(confirmed[unit] ?? []), field])];
        return { ...current, draft: next, confirmed };
      });
      fetchDraftLoad(next)
        .then(({ load }) => {
          if (version === edits.current) patch({ load });
        })
        .catch(() => undefined);
    },
    [patch],
  );

  async function openEditor() {
    const { draft } = latest.current;
    if (draft && !latest.current.load) {
      try {
        patch({ load: (await fetchDraftLoad(draft)).load });
      } catch {
        // The editor shows what it can.
      }
    }
    patch({ step: "edit" });
  }

  const editorTotal = simulatedKg;
  const canConfirm = Boolean(state.draft && weightsComplete(state.draft, editorTotal));

  /** The corrected load, through the battery again. */
  async function confirm(title?: string) {
    const { draft } = latest.current;
    if (!draft || !editorTotal) return;
    await simulate(draft, editorTotal, title);
  }

  /** `fromDraft`: the load just simulated (the state may not have caught up with it yet). */
  async function applyFix(fromDraft?: LoadDraft) {
    const { inspectionId, sample, truck, totalKg } = latest.current;
    const draft = fromDraft ?? latest.current.draft;
    if (!draft) return;
    patch({ busy: "plan", startedAt: Date.now(), error: null });
    try {
      let plan: Plan;
      if (inspectionId) plan = await calls.fix(inspectionId);
      else if (sample && same(draft.units, sample.perception.draft.units) && sampleApplies(sample, truck, totalKg)) plan = sample.plan;
      else plan = await runPlan(draft);
      patch({ plan, busy: null, startedAt: null });
    } catch (cause) {
      patch({ busy: null, startedAt: null, error: errorCode(cause) });
    }
  }

  async function share(): Promise<string | null> {
    const { inspectionId, shareUrl } = latest.current;
    if (shareUrl) return shareUrl;
    if (!inspectionId) return null;
    patch({ busy: "share" });
    try {
      const { path } = await request<{ token: string; path: string }>(`/inspections/${encodeURIComponent(inspectionId)}/share`, { method: "POST" });
      const url = `${window.location.origin}${document.documentElement.lang === "pt-BR" ? "/pt-BR" : ""}${path}`;
      patch({ shareUrl: url, busy: null });
      return url;
    } catch (cause) {
      patch({ busy: null, error: errorCode(cause) });
      return null;
    }
  }

  // ---- re-inspection ------------------------------------------------------------------------

  /** Start from a saved inspection: same truck and weight, a new photo, linked to the first. */
  async function startReinspection(parentId: string) {
    try {
      const parent = await request<InspectionDetail>(`/inspections/${encodeURIComponent(parentId)}`);
      const scenario = parent.scenarios.find((s) => s.kind === "as_loaded");
      const draft = (scenario?.draft ?? null) as LoadDraft | null;
      let battery: Battery | null = null;
      if (scenario?.battery_ref) {
        battery = scenario.battery_ref.startsWith("static:")
          ? await fetch(scenario.battery_ref.slice(7)).then((r) => (r.ok ? (r.json() as Promise<Battery>) : null))
          : await calls.battery(parentId, "as_loaded").catch(() => null);
      }
      const stored = parent.truck_json ? (JSON.parse(parent.truck_json) as Partial<LoadDraft["truck"]> & { truck_id?: string }) : draft?.truck;
      const truck = choiceOf(stored ?? null);
      setState((current) => ({
        ...INITIAL,
        savedTrucks: current.savedTrucks,
        parent: { id: parent.id, title: parent.title, battery },
        truck,
        truckFixed: Boolean(truck),
        weightSource: parent.weight_source ?? "measured",
        totalKg: parent.cargo_weight_kg,
        range: parent.weight_range_json ? (JSON.parse(parent.weight_range_json) as WeightRange) : null,
        step: "photos",
      }));
    } catch (cause) {
      patch({ error: errorCode(cause) });
    }
  }

  /** The driver gives the headboard height: the load is checked again on it. */
  async function setHeadboard(heightM: number) {
    const { truck, draft } = latest.current;
    if (!truck || !draft) return;
    const next = { ...truck, headboard_height_m: heightM };
    patch({ truck: next });
    await simulate({ ...draft, truck: draftTruck(next) }, simulatedKg ?? 0);
  }

  function goTo(step: Step) {
    patch({ step, error: null });
  }

  function restart() {
    for (const photo of latest.current.photos) if (photo.blob) URL.revokeObjectURL(photo.url);
    setState({ ...INITIAL, savedTrucks: latest.current.savedTrucks, step: latest.current.savedTrucks?.length ? "garage" : "photos" });
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
    guess,
    canSimulate,
    simulatedKg,
    canConfirm,
    allowance: me?.analysis ?? null,
    pickSaved,
    saveTruck,
    addPhoto,
    keepPending,
    discardPending,
    removePhoto,
    pickSample,
    toTruck,
    chooseSize,
    chooseStyle,
    setTruckStage: (truckStage: FlowState["truckStage"]) => patch({ truckStage }),
    buildPerception: () => buildPerception(),
    readInvoice,
    setWeight,
    setRange: (range: WeightRange | null) => patch({ range }),
    setPerUnit: (perUnit: Record<string, number> | null) => patch({ perUnit }),
    setNotes: (notes: string) => patch({ notes }),
    toResult,
    edit,
    openEditor,
    confirm,
    applyFix: () => applyFix(),
    share,
    setHeadboard,
    startReinspection,
    goTo,
    restart,
  };
}

/** No analysis (none allowed, or it failed): one crate at the headboard, to correct by hand. */
function manualStart(truck: LoadDraft["truck"]): PerceptionDraft {
  return {
    draft: {
      version: 1,
      source: "manual",
      truck,
      trip: { speed_kmh: 80, road: "straight", weather: "dry", event: "emergency_braking" },
      restraint: "top_over",
      units: [{ id: "unit-1", cargo: "crate", x_m: 0, y_m: 0, straps: 2, mass_kg: null }],
    },
    links: [],
    warnings: ["manual_start"],
  };
}
