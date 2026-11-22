/**
 * Our own side-view line drawing of a truck, to scale: every drawing shares one scale (1 unit =
 * 1 cm), taken from the truck catalog the simulation uses (`lib/inspection/truck-catalog.ts`),
 * so a VUC is visibly smaller than a semi-trailer and each axle stands where the simulation puts
 * it. The size sets the cab, the chassis and the axles; the body style sets what stands on the
 * deck (none: a neutral dashed outline of the load space). Plain geometry in the ink color: no
 * manufacturer's shapes or logos. The same drawing is used on the truck cards, in the result
 * summary, in the lists and on the shared summary page.
 */

import { cn } from "cn";

import { type CatalogTruck, LONGEST_M, TRUCK_CATALOG } from "@/lib/inspection/truck-catalog";
import type { BodyStyle, TruckSize } from "@/lib/inspection/trucks";

/** Height of every drawing [cm]: ground at GROUND, the tallest body (4.1 m) fits above it. */
export const VIEW_H = 440;
const GROUND = 432;
const MARGIN = 12;
const STROKE = 9;
const THIN = 5;

const X = (m: number) => MARGIN + m * 100;
const Y = (m: number) => GROUND - m * 100;
/** Width of a truck's drawing [cm], margins included. */
export const viewWidth = (truck: CatalogTruck) => truck.length_m * 100 + 2 * MARGIN;
const LONGEST_VIEW = LONGEST_M * 100 + 2 * MARGIN;

function CabOver({ truck }: { truck: CatalogTruck }) {
  const { length_m: l, height_m: h } = truck.cab;
  const front = 0.08;
  const bottom = 0.55;
  const shoulder = h * 0.62;
  const glass = (
    <path
      d={`M${X(front + 0.14)} ${Y(shoulder + 0.06)}L${X(front + 0.42)} ${Y(h - 0.2)}H${X(l * 0.62)}V${Y(shoulder + 0.06)}Z`}
      strokeWidth={THIN}
    />
  );
  return (
    <g data-part="cab">
      <path
        d={`M${X(front)} ${Y(bottom)}V${Y(shoulder)}L${X(front + 0.34)} ${Y(h - 0.06)}Q${X(front + 0.38)} ${Y(h)} ${X(front + 0.5)} ${Y(h)}H${X(l)}V${Y(bottom)}Z`}
      />
      {glass}
      {/* Door and step. */}
      <path d={`M${X(l * 0.66)} ${Y(shoulder + 0.06)}V${Y(bottom + 0.25)}`} strokeWidth={THIN} />
      <path d={`M${X(0)} ${Y(bottom)}H${X(front + 0.5)}`} />
    </g>
  );
}

function Conventional({ truck }: { truck: CatalogTruck }) {
  const { length_m: l, height_m: h } = truck.cab;
  const bottom = 0.6;
  const hood = 1.75;
  const cab0 = 2.0;
  const cabRoof = h - 0.75;
  const sleeper = l - 1.5;
  return (
    <g data-part="cab">
      {/* Hood with the grille in front, the cab behind it and a raised sleeper roof. */}
      <path
        d={`M${X(0.04)} ${Y(bottom)}V${Y(hood - 0.1)}Q${X(0.06)} ${Y(hood)} ${X(0.3)} ${Y(hood)}L${X(cab0)} ${Y(hood + 0.2)}L${X(cab0 + 0.5)} ${Y(cabRoof)}H${X(sleeper)}L${X(sleeper + 0.3)} ${Y(h)}H${X(l)}V${Y(bottom)}Z`}
      />
      <path d={`M${X(cab0 + 0.12)} ${Y(hood + 0.32)}L${X(cab0 + 0.52)} ${Y(cabRoof - 0.12)}H${X(cab0 + 0.95)}V${Y(hood + 0.32)}Z`} strokeWidth={THIN} />
      <path d={`M${X(0.04)} ${Y(bottom + 0.35)}H${X(0.3)}`} strokeWidth={THIN} />
      <path d={`M${X(cab0 + 1.05)} ${Y(hood + 0.32)}V${Y(bottom + 0.25)}`} strokeWidth={THIN} />
    </g>
  );
}

function Headboard({ x, floor, height }: { x: number; floor: number; height: number }) {
  return (
    <g data-part="headboard">
      <rect x={X(x)} y={Y(floor + height)} width={9} height={height * 100} />
      <path d={`M${X(x)} ${Y(floor + height * 0.5)}h9`} strokeWidth={THIN} />
    </g>
  );
}

/** Evenly spaced positions between two ends, `count` gaps. */
function stations(x0: number, x1: number, count: number): number[] {
  return Array.from({ length: count + 1 }, (_, n) => x0 + ((x1 - x0) * n) / count);
}

function Body({ truck, style, code }: { truck: CatalogTruck; style: BodyStyle | null; code: "L" | "XL" | null }) {
  const { front_x_m: x0, length_m: len, floor_m: floor, wall_m: wall, headboard_m: headboard } = truck.deck;
  const x1 = x0 + len;
  const deckTop = floor;
  // A step deck's upper deck ahead of the lower one: the step is its front stop.
  const front = truck.upper_deck ? truck.upper_deck.front_x_m : x0;
  switch (style) {
    case null:
      return (
        <rect
          data-part="load-space"
          x={X(front)}
          y={Y(deckTop + wall)}
          width={(x1 - front) * 100}
          height={wall * 100}
          strokeDasharray="22 18"
          strokeWidth={THIN}
          stroke="var(--control-border)"
        />
      );
    case "platform":
      return truck.upper_deck ? null : <Headboard x={x0} floor={deckTop} height={headboard} />;
    case "open_low_sides": {
      const side = 0.55;
      const panels = Math.max(2, Math.round(len / 2.1));
      return (
        <g data-part="drop-sides">
          <Headboard x={x0} floor={deckTop} height={Math.max(headboard, side + 0.4)} />
          <rect x={X(x0)} y={Y(deckTop + side)} width={len * 100} height={side * 100} />
          {stations(x0, x1, panels)
            .slice(1, -1)
            .map((x) => (
              <path key={x} d={`M${X(x)} ${Y(deckTop + side)}V${Y(deckTop)}`} strokeWidth={THIN} />
            ))}
          {/* Hinges along the bottom edge: the boards fold down. */}
          {stations(x0, x1, panels * 2)
            .filter((_, n) => n % 2 === 1)
            .map((x) => (
              <path key={`h${x}`} d={`M${X(x) - 12} ${Y(deckTop + 0.06)}h24`} strokeWidth={THIN} />
            ))}
        </g>
      );
    }
    case "open_tall_rack": {
      // A grain body ("graneleiro"): tall plank sides held by posts that stand above them.
      const top = 1.45;
      const posts = Math.max(3, Math.round(len / 1.25));
      return (
        <g data-part="tall-rack">
          <Headboard x={x0} floor={deckTop} height={top + 0.1} />
          <rect x={X(x0)} y={Y(deckTop + top)} width={len * 100} height={top * 100} />
          {[0.36, 0.72, 1.08].map((h) => (
            <path key={h} d={`M${X(x0)} ${Y(deckTop + h)}H${X(x1)}`} strokeWidth={THIN} />
          ))}
          {stations(x0, x1, posts)
            .slice(1)
            .map((x) => (
              <path key={x} data-part="post" d={`M${X(x) - 6} ${Y(deckTop)}V${Y(deckTop + top + 0.12)}`} />
            ))}
        </g>
      );
    }
    case "box": {
      const roof = deckTop + wall + 0.12;
      return (
        <g data-part="box">
          <rect x={X(x0)} y={Y(roof)} width={len * 100} height={(roof - deckTop) * 100} />
          <path d={`M${X(x0)} ${Y(roof - 0.12)}H${X(x1)}`} strokeWidth={THIN} />
          {/* Rear doors and their hinges. */}
          <path d={`M${X(x1 - 0.12)} ${Y(roof - 0.12)}V${Y(deckTop)}`} strokeWidth={THIN} />
          {[0.25, 0.5, 0.75].map((share) => (
            <path key={share} d={`M${X(x1 - 0.12)} ${Y(deckTop + wall * share)}h-14`} strokeWidth={THIN} />
          ))}
          {code && <CodeMark code={code} x={x1 - 0.3} y={roof - 0.75} />}
        </g>
      );
    }
    case "curtain_sider": {
      const roof = deckTop + wall + 0.12;
      const rail = 0.16;
      const bays = Math.max(2, Math.round(len / 3));
      const posts = stations(x0, x1, bays);
      const folds: number[] = [];
      for (let bay = 0; bay < bays; bay++) {
        const a = posts[bay] ?? x0;
        const b = posts[bay + 1] ?? x1;
        const count = Math.max(2, Math.round((b - a) / 0.42));
        folds.push(...stations(a, b, count).slice(1, -1));
      }
      const top = roof - rail;
      const bottom = deckTop + rail;
      const sag = (top - bottom) * 100;
      return (
        <g data-part="curtain">
          <rect x={X(x0)} y={Y(roof)} width={len * 100} height={(roof - deckTop) * 100} />
          <path d={`M${X(x0)} ${Y(top)}H${X(x1)}M${X(x0)} ${Y(bottom)}H${X(x1)}`} strokeWidth={THIN} />
          {posts.slice(1, -1).map((x) => (
            <rect key={x} data-part="post" x={X(x) - 6} y={Y(top)} width={12} height={sag} strokeWidth={THIN} />
          ))}
          {folds.map((x) => (
            <path key={x} data-part="fold" d={`M${X(x)} ${Y(top)}q10 ${sag / 2} 0 ${sag}`} strokeWidth={THIN} opacity={0.75} />
          ))}
          {code && <CodeMark code={code} x={x1 - 0.3} y={roof - 0.75} />}
        </g>
      );
    }
  }
}

function CodeMark({ code, x, y }: { code: "L" | "XL"; x: number; y: number }) {
  return (
    <text x={X(x)} y={Y(y)} textAnchor="end" fontSize={60} fill="currentColor" stroke="none" fontFamily="inherit" data-part="code">
      {code}
    </text>
  );
}

function Chassis({ truck }: { truck: CatalogTruck }) {
  const { deck, coupling, upper_deck: upper } = truck;
  const deckEnd = deck.front_x_m + deck.length_m;
  const beam = 0.14;
  const parts = [];
  if (coupling) {
    // Tractor frame, fifth wheel, and the semi-trailer's deck with its landing gear.
    const trailerFloor = upper ? upper.floor_m : deck.floor_m;
    const frame = 1.0;
    parts.push(
      <path key="frame" d={`M${X(truck.cab.length_m)} ${Y(frame)}H${X(coupling.frame_end_x_m)}`} />,
      <path
        key="fifth"
        data-part="fifth-wheel"
        d={`M${X(coupling.kingpin_x_m - 0.45)} ${Y(frame)}L${X(coupling.kingpin_x_m - 0.3)} ${Y(trailerFloor - beam)}H${X(coupling.kingpin_x_m + 0.3)}L${X(coupling.kingpin_x_m + 0.45)} ${Y(frame)}`}
      />,
    );
    const legs = Math.max(coupling.frame_end_x_m + 0.5, coupling.kingpin_x_m + 2.2);
    const legFloor = upper && legs < upper.front_x_m + upper.length_m ? upper.floor_m : deck.floor_m;
    parts.push(
      <path key="legs" data-part="landing-gear" d={`M${X(legs)} ${Y(legFloor - beam)}V${Y(0.32)}M${X(legs) - 14} ${Y(0.32)}h28`} />,
    );
  } else {
    parts.push(<path key="frame" d={`M${X(truck.cab.length_m)} ${Y(deck.floor_m - beam - 0.12)}H${X(deckEnd - 0.2)}`} />);
    // Rear underrun bar.
    parts.push(<path key="bar" d={`M${X(deckEnd - 0.15)} ${Y(deck.floor_m - beam)}V${Y(0.5)}h-22`} strokeWidth={THIN} />);
  }
  if (upper) {
    const step = upper.front_x_m + upper.length_m;
    parts.push(
      <rect key="upper" data-part="upper-deck" x={X(upper.front_x_m)} y={Y(upper.floor_m)} width={upper.length_m * 100} height={beam * 100} />,
      <path key="step" data-part="step" d={`M${X(step)} ${Y(upper.floor_m - beam)}V${Y(deck.floor_m)}`} />,
    );
  }
  parts.push(<rect key="deck" data-part="deck" x={X(deck.front_x_m)} y={Y(deck.floor_m)} width={deck.length_m * 100} height={beam * 100} />);
  if (truck.slider) {
    const trailer = truck.axles.filter((axle) => axle.group === "trailer").map((axle) => axle.x_m);
    const a = Math.min(...trailer) - 1.4;
    const b = Math.max(...trailer) + 0.9;
    parts.push(
      <g key="slider" data-part="slider">
        <path d={`M${X(a)} ${Y(deck.floor_m - beam - 0.12)}H${X(b)}`} strokeWidth={THIN} />
        {stations(a, b, Math.round((b - a) / 0.35)).map((x) => (
          <circle key={x} cx={X(x)} cy={Y(deck.floor_m - beam - 0.06)} r={3} fill="currentColor" stroke="none" />
        ))}
      </g>,
    );
  }
  return <g data-part="chassis">{parts}</g>;
}

export function TruckArt({
  size,
  style,
  className,
  title,
  code = null,
  scaled = false,
  placement,
}: {
  size: TruckSize;
  /** The body; null draws the chassis with a neutral outline of the load space. */
  style: BodyStyle | null;
  /** EN 12642 code (EU mode): marked on a closed body. */
  code?: "L" | "XL" | null;
  className?: string;
  /** Accessible name; without it the drawing is decorative. */
  title?: string;
  /**
   * Width as a share of the container against the longest truck, so a grid of cards shows every
   * truck at one scale. Without it, give the drawing a height: the scale is then shared too.
   */
  scaled?: boolean;
  /** Nested inside another drawing: its box there (the stroke then scales with it). */
  placement?: { x: number; y: number; width: number; height: number };
}) {
  const truck = TRUCK_CATALOG[size];
  const width = viewWidth(truck);
  const r = truck.wheel_m * 50;
  return (
    <svg
      viewBox={`0 0 ${width} ${VIEW_H}`}
      {...placement}
      className={cn("text-ink", scaled ? "block h-auto" : "h-auto w-full", className)}
      style={scaled ? { width: `${(width / LONGEST_VIEW) * 100}%` } : undefined}
      fill="none"
      stroke="currentColor"
      strokeWidth={STROKE}
      strokeLinejoin="round"
      strokeLinecap="round"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      data-truck-size={size}
      data-truck-style={style ?? "neutral"}
      data-axles={truck.axle_count}
      data-length-m={truck.length_m}
      data-body-code={code ?? undefined}
    >
      {title && <title>{title}</title>}
      <Chassis truck={truck} />
      {truck.cab.kind === "conventional" ? <Conventional truck={truck} /> : <CabOver truck={truck} />}
      <Body truck={truck} style={style} code={code} />
      {truck.axles.map((axle) => (
        <g key={axle.x_m} data-part="wheel" data-group={axle.group}>
          <circle cx={X(axle.x_m)} cy={GROUND - r} r={r} fill="var(--paper)" />
          <circle cx={X(axle.x_m)} cy={GROUND - r} r={r * 0.38} strokeWidth={THIN} />
        </g>
      ))}
      <path d={`M0 ${GROUND + 2}H${width}`} strokeWidth={THIN} stroke="var(--control-border)" />
    </svg>
  );
}
