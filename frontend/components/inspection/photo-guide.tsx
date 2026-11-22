/**
 * How to take each photo: what the phone's screen should show (the whole truck inside the framing
 * marks, the load visible), and small "like this / not like this" thumbnails (too close, cut off,
 * at night) made from the same drawing (zoomed in, shifted, darkened).
 *
 * The drawings are not drawn by hand: they are the replay's 3D truck (a toco with low drop sides
 * and ten strapped pallets) drawn with hidden lines removed, from an orthographic side view and
 * from a phone held level at 1.5 m behind the truck, 35° off its axis
 * (`lib/inspection/photo-guide-art.test.ts` writes `photo-guide-art.json`; `pnpm run guides`).
 * The same drawing, without the phone, is the overlay of the guided camera.
 */

import { cn } from "cn";
import { useId } from "react";

import ART from "@/lib/inspection/photo-guide-art.json";
import type { Shot } from "@/lib/inspection/use-flow";

export type GuideVariant = "good" | "too_close" | "cut_off" | "night";

const W = ART.frame.width;
const H = ART.frame.height;

/** Corner marks around the box the truck must fill. */
function FramingMarks({ box }: { box: number[] }) {
  const pad = 10;
  const [x0, y0, x1, y1] = [(box[0] ?? 0) - pad, (box[1] ?? 0) - pad, (box[2] ?? W) + pad, (box[3] ?? H) + pad];
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
  too_close: `translate(${W / 2} ${H / 2}) scale(2.1) translate(${-W / 2} ${-H / 2})`,
  // The rear of the load runs out of the frame.
  cut_off: "translate(118 0)",
  night: undefined,
};

/** What the screen shows: the drawing and, on the "like this" guide, its framing marks. */
function Screen({ shot, variant, overlay }: { shot: Shot; variant: GuideVariant; overlay: boolean }) {
  const art = ART[shot];
  const night = variant === "night";
  return (
    <g>
      {!overlay && <rect x={0} y={0} width={W} height={H} fill={night ? "var(--ink)" : "var(--paper)"} stroke="none" />}
      <g
        transform={TRANSFORMS[variant]}
        opacity={night ? 0.3 : overlay ? 0.55 : 1}
        className={night || overlay ? "text-paper" : "text-ink"}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={art.ground} strokeWidth={0.8} stroke={night || overlay ? "currentColor" : "var(--control-border)"} />
        <path d={art.detail} strokeWidth={0.7} data-part="detail" />
        <path d={art.outline} strokeWidth={1.15} data-part="outline" />
      </g>
      {night && <circle cx={292} cy={26} r={8} fill="var(--paper)" opacity={0.6} stroke="none" />}
      {variant === "good" && (
        <g stroke="currentColor" fill="none">
          <FramingMarks box={art.box} />
        </g>
      )}
    </g>
  );
}

/** A phone held sideways around the screen (or, with `phone={false}`, the screen alone). */
export function PhotoGuide({
  shot,
  variant = "good",
  phone = true,
  overlay = false,
  className,
  title,
}: {
  shot: Shot;
  variant?: GuideVariant;
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
        <Screen shot={shot} variant={variant} overlay={overlay} />
      </g>
      {phone && <rect x={0} y={0} width={W} height={H} rx={6} strokeWidth={1} />}
    </svg>
  );
}
