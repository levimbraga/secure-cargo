/**
 * Our own side-view line drawing of a truck: the size sets the length, the cab and the axle
 * count; the body style sets what stands on the deck. Plain geometry in the ink color: no
 * manufacturer's shapes or logos. The same drawing is used on the truck cards, in the result
 * summary, in the lists and on the shared summary page.
 */

import { cn } from "cn";

import { type BodyStyle, SIZE_INFO, type TruckSize } from "@/lib/inspection/trucks";

const H = 64;
const GROUND = 56;
const WHEEL = 5.5;
const DECK = 38;

type Geometry = {
  width: number;
  cab: [number, number];
  bed: [number, number];
  axles: number[];
  tractor?: boolean;
  /** A US conventional cab: the engine under a hood in front of the cab. */
  hood?: boolean;
  /** A step deck: the upper deck ends at this x, the lower deck runs from here to the rear. */
  step?: number;
};

/** X positions in a box that is as long as the truck (cab on the left, facing left). */
function geometry(size: TruckSize): Geometry {
  switch (size) {
    case "vuc":
      return { width: 120, cab: [6, 34], bed: [36, 114], axles: [22, 92] };
    case "three_quarter":
      return { width: 136, cab: [6, 36], bed: [38, 130], axles: [22, 104] };
    case "toco":
      return { width: 160, cab: [6, 40], bed: [42, 154], axles: [24, 124] };
    case "truck":
      return { width: 184, cab: [6, 40], bed: [42, 178], axles: [24, 132, 146] };
    case "semi":
      return { width: 232, cab: [6, 40], bed: [48, 226], axles: [22, 46, 60, 182, 196, 210], tractor: true };
    // US presets: conventional cabs (hood), drawn to the same scale as the others.
    case "us_box":
      return { width: 176, cab: [6, 46], bed: [48, 170], axles: [20, 134], hood: true };
    case "us_straight":
      return { width: 184, cab: [6, 46], bed: [48, 178], axles: [20, 136, 150], hood: true };
    case "us_flatbed_48":
      return { width: 288, cab: [6, 48], bed: [56, 282], axles: [20, 54, 68, 246, 260], tractor: true, hood: true };
    case "us_dry_van_53":
      return { width: 304, cab: [6, 48], bed: [56, 298], axles: [20, 54, 68, 262, 276], tractor: true, hood: true };
    case "us_step_deck":
      return { width: 288, cab: [6, 48], bed: [56, 282], axles: [20, 54, 68, 246, 260], tractor: true, hood: true, step: 96 };
    // EU presets: flat-fronted cabs over the engine; a 4x2 tractor and a tri-axle semi-trailer.
    case "eu_7_5t":
      return { width: 140, cab: [6, 36], bed: [38, 134], axles: [22, 104] };
    case "eu_18t":
      return { width: 164, cab: [6, 40], bed: [42, 158], axles: [24, 126] };
    case "eu_26t":
      return { width: 196, cab: [6, 40], bed: [42, 190], axles: [24, 140, 154] };
    case "eu_semi_136":
    case "eu_flatbed_136":
      return { width: 276, cab: [6, 40], bed: [48, 270], axles: [22, 54, 214, 228, 242], tractor: true };
  }
}

function Body({ style, x0, x1 }: { style: BodyStyle; x0: number; x1: number }) {
  const top = 12;
  switch (style) {
    case "platform":
      return null;
    case "open_low_sides":
      return <rect x={x0} y={DECK - 8} width={x1 - x0} height={8} />;
    case "open_tall_rack": {
      const posts = Math.max(3, Math.round((x1 - x0) / 18));
      return (
        <g>
          <rect x={x0} y={DECK - 8} width={x1 - x0} height={8} />
          <path d={`M${x0} ${DECK - 26}H${x1}`} />
          {Array.from({ length: posts + 1 }, (_, n) => {
            const x = x0 + ((x1 - x0) * n) / posts;
            return <path key={n} d={`M${x} ${DECK - 8}V${DECK - 26}`} />;
          })}
        </g>
      );
    }
    case "box":
      return <rect x={x0} y={top} width={x1 - x0} height={DECK - top} />;
    case "curtain_sider": {
      const folds = Math.max(4, Math.round((x1 - x0) / 10));
      return (
        <g>
          <rect x={x0} y={top} width={x1 - x0} height={DECK - top} />
          {Array.from({ length: folds - 1 }, (_, n) => {
            const x = x0 + ((x1 - x0) * (n + 1)) / folds;
            return <path key={n} d={`M${x} ${top + 3}q2 ${(DECK - top - 6) / 2} 0 ${DECK - top - 6}`} strokeWidth={0.9} />;
          })}
        </g>
      );
    }
  }
}

export function TruckArt({
  size,
  style,
  className,
  title,
  code = null,
}: {
  size: TruckSize;
  style: BodyStyle;
  /** EN 12642 code (EU mode): an XL body is drawn with its rated side walls marked. */
  code?: "L" | "XL" | null;
  className?: string;
  /** Accessible name; without it the drawing is decorative. */
  title?: string;
}) {
  const g = geometry(size);
  const [c0, c1] = g.cab;
  const [b0, b1] = g.bed;
  const cabTop = size === "vuc" || size === "three_quarter" ? 18 : 12;
  // A step deck's lower deck (what is loaded) starts at the step; its upper deck is higher.
  const lower = g.step ?? b0;
  return (
    <svg
      viewBox={`0 0 ${g.width} ${H}`}
      className={cn("h-auto w-full text-ink", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinejoin="round"
      strokeLinecap="round"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      data-truck-size={size}
      data-truck-style={style}
      data-axles={SIZE_INFO[size].axles}
      data-body-code={code ?? undefined}
    >
      {title && <title>{title}</title>}
      {g.hood ? (
        <>
          {/* Conventional cab: a hood in front, then the cab with its window. */}
          <path d={`M${c1} ${DECK + 6}V${cabTop}H${c0 + 20}L${c0 + 16} ${cabTop + 12}H${c0 + 2}L${c0} ${cabTop + 16}V${DECK + 6}Z`} />
          <path d={`M${c0 + 21} ${cabTop + 3}H${c1 - 4}V${cabTop + 11}H${c0 + 18}Z`} strokeWidth={1} />
        </>
      ) : (
        <>
          {/* Cab: a box with a sloped windscreen and a window. */}
          <path d={`M${c1} ${DECK + 6}V${cabTop}H${c0 + 10}L${c0} ${cabTop + 12}V${DECK + 6}Z`} />
          <path d={`M${c0 + 11} ${cabTop + 3}H${c1 - 4}V${cabTop + 12}H${c0 + 5}Z`} strokeWidth={1} />
        </>
      )}
      {/* Chassis and deck. */}
      <path d={`M${c1} ${DECK + 6}H${b1}`} />
      {g.step ? (
        <>
          <rect x={b0} y={DECK - 7} width={lower - b0} height={4} />
          <path d={`M${lower} ${DECK - 3}V${DECK}`} />
          <rect x={lower} y={DECK} width={b1 - lower} height={4} />
        </>
      ) : (
        <rect x={b0} y={DECK} width={b1 - b0} height={4} />
      )}
      {g.tractor && <path d={`M${c1} ${DECK + 2}H${b0 + 20}`} strokeDasharray="2 2" strokeWidth={1} />}
      {/* Headboard, except on a closed body whose front wall is the box itself. */}
      {style !== "box" && style !== "curtain_sider" && !g.step && <path d={`M${b0} ${DECK}V${DECK - 16}`} strokeWidth={2} />}
      <Body style={style} x0={lower} x1={b1} />
      {code && style !== "platform" && style !== "open_low_sides" && style !== "open_tall_rack" && (
        <text x={b1 - 4} y={DECK - 4} textAnchor="end" fontSize={9} fill="currentColor" stroke="none" fontFamily="inherit">
          {code}
        </text>
      )}
      {/* Wheels: one per axle. */}
      {g.axles.map((x) => (
        <circle key={x} cx={x} cy={GROUND - WHEEL} r={WHEEL} fill="var(--paper)" />
      ))}
      <path d={`M0 ${GROUND + 0.5}H${g.width}`} strokeWidth={0.75} className="text-hairline" stroke="var(--control-border)" />
    </svg>
  );
}
