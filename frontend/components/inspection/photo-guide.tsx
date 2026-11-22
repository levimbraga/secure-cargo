/**
 * How to take each photo: a line drawing of what the phone's screen should show (the whole
 * truck inside the framing marks, the load visible, the phone held level at about 1.5 m), and
 * small "like this / not like this" thumbnails (too close, cut off, at night). Our own drawings
 * in the ink color; the same scene, without the phone, is the overlay of the guided camera.
 */

import { cn } from "cn";
import { type ReactNode, useId } from "react";

import type { Shot } from "@/lib/inspection/use-flow";

import { TruckArt, VIEW_H, viewWidth } from "./truck-art";
import { TRUCK_CATALOG } from "@/lib/inspection/truck-catalog";

export type GuideVariant = "good" | "too_close" | "cut_off" | "night";

const W = 320;
const H = 180;
const GROUND_Y = 150;

// The side scene: a three-axle truck with an open body and a load of crates on it.
const SIDE = TRUCK_CATALOG.truck;
const SIDE_W = 272;
const SIDE_X = (W - SIDE_W) / 2;
const SCALE = SIDE_W / viewWidth(SIDE); // px per cm
const SIDE_H = VIEW_H * SCALE;
const SIDE_Y = GROUND_Y - 432 * SCALE;
const px = (m: number) => SIDE_X + (12 + m * 100) * SCALE;
const py = (m: number) => GROUND_Y - m * 100 * SCALE;

function SideScene({ tone }: { tone?: string }) {
  const { front_x_m: x0, length_m: len, floor_m: floor } = SIDE.deck;
  const crates = [0.15, 1.55, 2.95, 4.35, 5.75].map((offset) => x0 + offset);
  return (
    <g>
      <TruckArt size="truck" style="open_low_sides" className={tone} placement={{ x: SIDE_X, y: SIDE_Y, width: SIDE_W, height: SIDE_H }} />
      <g fill="var(--paper)" stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round">
        {crates
          .filter((x) => x + 1.2 <= x0 + len)
          .map((x) => (
            <g key={x}>
              <rect x={px(x)} y={py(floor + 1.25)} width={1.2 * 100 * SCALE} height={1.25 * 100 * SCALE} />
              <path d={`M${px(x)} ${py(floor + 0.62)}h${1.2 * 100 * SCALE}`} strokeWidth={0.8} />
            </g>
          ))}
        {/* The straps over the load. */}
        {crates.slice(0, 5).map((x) => (
          <path key={`s${x}`} d={`M${px(x + 0.6)} ${py(floor + 1.25)}V${py(floor)}`} strokeWidth={1.1} strokeDasharray="none" stroke="currentColor" />
        ))}
      </g>
    </g>
  );
}

/** The truck from behind one rear corner: the back square to the camera, one side going away. */
function RearScene() {
  return (
    <g fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round">
      {/* Cab at the far end. */}
      <path d="M276 108V60l8-10h22v54" fill="var(--paper)" />
      <path d="M284 56h18v16h-22z" strokeWidth={1} />
      {/* Load: crates seen from the back and the side, above the body. */}
      <path d="M74 104V64h62v40" fill="var(--paper)" />
      <path d="M74 64l116-20h58l-112 20" fill="var(--paper)" />
      <path d="M136 64l112-20v38l-112 22" fill="var(--paper)" />
      <path d="M74 84h62l112-21" strokeWidth={1} />
      <path d="M105 64v40M192 52v35" strokeWidth={1} />
      {/* Strap over the load. */}
      <path d="M100 62l114-19M214 43v40" strokeWidth={1.2} />
      {/* Body: tailgate (back) and the side board going away to the cab. */}
      <path d="M60 104h92v20H60z" fill="var(--paper)" />
      <path d="M152 104l124-24v18l-124 26" fill="var(--paper)" />
      <path d="M60 104l13-6" strokeWidth={1} />
      {/* Chassis, bumper and wheels. */}
      <path d="M66 128h80" />
      <rect x="68" y="126" width="18" height="24" rx="4" fill="var(--paper)" />
      <rect x="124" y="126" width="18" height="24" rx="4" fill="var(--paper)" />
      <ellipse cx="176" cy="132" rx="8" ry="12" fill="var(--paper)" />
      <ellipse cx="194" cy="128" rx="7" ry="11" fill="var(--paper)" />
      <ellipse cx="270" cy="114" rx="5" ry="8" fill="var(--paper)" />
    </g>
  );
}

const SCENES: Record<Shot, { scene: (props: { tone?: string }) => ReactNode; box: [number, number, number, number]; eye: number }> = {
  // Framing box [x0, y0, x1, y1] around the whole truck; eye: the 1.5 m level on the truck.
  side: { scene: SideScene, box: [SIDE_X - 14, py(SIDE.cab.height_m) - 14, SIDE_X + SIDE_W + 12, GROUND_Y + 10], eye: py(1.5) },
  rear_three_quarter: { scene: RearScene, box: [48, 34, 318 - 6, 160], eye: 104 },
};

/** Corner marks around the box the truck must fill. */
function FramingMarks({ box }: { box: [number, number, number, number] }) {
  const [x0, y0, x1, y1] = box;
  const k = 14;
  return (
    <path
      d={`M${x0} ${y0 + k}V${y0}h${k}M${x1 - k} ${y0}h${k}v${k}M${x1} ${y1 - k}v${k}h${-k}M${x0 + k} ${y1}h${-k}v${-k}`}
      strokeWidth={2.4}
      strokeLinecap="square"
      data-part="framing-marks"
    />
  );
}

const TRANSFORMS: Record<GuideVariant, string | undefined> = {
  good: undefined,
  // Close enough to fill the screen twice: the cab and the rear are out of the frame.
  too_close: `translate(${W / 2} ${H / 2}) scale(2.1) translate(${-W / 2} ${-H / 2 - 6})`,
  // The rear of the load runs out of the frame.
  cut_off: "translate(118 0)",
  night: undefined,
};

/** What the screen shows: the scene, its framing marks and the 1.5 m eye level. */
function Screen({ shot, variant, eyeLabel, overlay }: { shot: Shot; variant: GuideVariant; eyeLabel?: string; overlay: boolean }) {
  const { scene: Scene, box, eye } = SCENES[shot];
  const night = variant === "night";
  return (
    <g>
      {!overlay && <rect x={0} y={0} width={W} height={H} fill={night ? "var(--ink)" : "var(--paper)"} stroke="none" />}
      <g transform={TRANSFORMS[variant]} opacity={night ? 0.22 : overlay ? 0.45 : 1} className={night || overlay ? "text-paper" : "text-ink"}>
        <path d={`M-200 ${GROUND_Y + 4}H${W + 200}`} strokeWidth={0.8} stroke="var(--control-border)" />
        <Scene tone={night || overlay ? "text-paper!" : undefined} />
      </g>
      {night && <circle cx={286} cy={30} r={9} fill="var(--paper)" opacity={0.6} stroke="none" />}
      {variant === "good" && (
        <g stroke="currentColor" fill="none">
          <FramingMarks box={box} />
          {eyeLabel && (
            <g data-part="eye-level">
              <path d={`M6 ${eye}H${W - 6}`} strokeWidth={0.9} strokeDasharray="5 4" />
              {/* Legend in the top corner, clear of the drawing. */}
              <path d="M10 14h18" strokeWidth={0.9} strokeDasharray="5 4" />
              <text x={32} y={18} fontSize={11} fill="currentColor" stroke="none" fontFamily="inherit">
                {eyeLabel}
              </text>
            </g>
          )}
        </g>
      )}
    </g>
  );
}

/** A phone held sideways around the screen. */
export function PhotoGuide({
  shot,
  variant = "good",
  eyeLabel,
  phone = true,
  overlay = false,
  className,
  title,
}: {
  shot: Shot;
  variant?: GuideVariant;
  /** The "≈ 1.5 m" label of the eye-level line (only on the "like this" guide). */
  eyeLabel?: string;
  phone?: boolean;
  /** Over the camera's live picture: no background, the drawing faint, the marks strong. */
  overlay?: boolean;
  className?: string;
  title?: string;
}) {
  const clip = useId();
  const pad = phone ? 16 : 0;
  return (
    <svg
      viewBox={`${-pad} ${-pad} ${W + 2 * pad} ${H + 2 * pad}`}
      className={cn("h-auto w-full", overlay ? "text-paper" : "text-ink", className)}
      fill="none"
      stroke="currentColor"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      data-guide={shot}
      data-variant={variant}
    >
      {title && <title>{title}</title>}
      <defs>
        <clipPath id={clip}>
          <rect x={0} y={0} width={W} height={H} rx={phone ? 6 : 0} />
        </clipPath>
      </defs>
      {phone && (
        <g strokeWidth={2.2}>
          <rect x={-12} y={-12} width={W + 24} height={H + 24} rx={20} fill="var(--paper)" />
          <circle cx={W + 6} cy={H / 2} r={2.2} fill="currentColor" stroke="none" />
        </g>
      )}
      <g clipPath={`url(#${clip})`}>
        <Screen shot={shot} variant={variant} eyeLabel={eyeLabel} overlay={overlay} />
      </g>
      {phone && <rect x={0} y={0} width={W} height={H} rx={6} strokeWidth={1} />}
    </svg>
  );
}
