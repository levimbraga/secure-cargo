"use client";

import type { UnitDetails } from "@/lib/unit-details";

export type UnitPanelLabels = {
  /** Accessible name of the panel: "Forces on Pallet 2". */
  region: string;
  /** Name of the unit: "Pallet 2". */
  title: string;
  close: string;
  inertia: string;
  friction: string;
  floor: string;
  slide: string;
  /** "Lashing 2" */
  lashing: (number: number) => string;
  /** Tension against the capacity, in daN: "300 of 2,500 daN · 12%". */
  tension: (tensionN: number, capacityN: number | null) => string;
  noLashing: string;
  /** "6.7 kN" */
  kilonewtons: (newtons: number) => string;
  /** "12.4 cm" */
  centimetres: (metres: number) => string;
};

export type UnitPanelProps = {
  id?: string;
  /** Number on the marker of the unit in the scene (1-based). */
  number: number;
  details: UnitDetails;
  labels: UnitPanelLabels;
  onClose: () => void;
};

function Row({ label, alert = false, children }: { label: string; alert?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <dt className="text-gray">{label}</dt>
      <dd className={`text-right font-mono text-[0.8125rem] tabular-nums ${alert ? "text-fail" : "text-ink"}`}>
        {children}
      </dd>
    </div>
  );
}

/**
 * The numbers of one unit at the instant on screen, for the phone layout of the engineering
 * view: opened by the unit's marker in the scene, closed by its button or the Escape key.
 */
export function UnitPanel({ id, number, details, labels, onClose }: UnitPanelProps) {
  return (
    <div
      id={id}
      role="region"
      aria-label={labels.region}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
      className="mt-2 rounded bg-surface pb-2 pl-3"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-medium text-ink">
          <span
            aria-hidden
            className="flex size-6 shrink-0 items-center justify-center rounded-full bg-ink font-mono text-[0.75rem] leading-none text-paper"
          >
            {number}
          </span>
          {labels.title}
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label={labels.close}
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-gray hover:text-ink"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M3 3l8 8M11 3l-8 8" />
          </svg>
        </button>
      </div>
      <dl className="type-small pr-3">
        <Row label={labels.inertia} alert={details.slipping}>
          {labels.kilonewtons(details.inertia)}
        </Row>
        <Row label={labels.friction}>{labels.kilonewtons(details.friction)}</Row>
        <Row label={labels.floor}>{labels.kilonewtons(details.floor)}</Row>
        <Row label={labels.slide}>{labels.centimetres(details.slide)}</Row>
        {details.lashings.map((lashing, index) => (
          <Row
            key={lashing.id}
            label={labels.lashing(index + 1)}
            alert={lashing.ratio !== null && lashing.ratio >= 1}
          >
            {labels.tension(lashing.tension, lashing.capacity)}
          </Row>
        ))}
      </dl>
      {details.lashings.length === 0 && <p className="type-small pr-3 py-1 text-gray">{labels.noLashing}</p>}
    </div>
  );
}
