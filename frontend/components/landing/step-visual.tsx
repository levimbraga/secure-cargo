export const STEPS = ["photo", "perceive", "simulate", "plan", "certificate"] as const;
export type Step = (typeof STEPS)[number];

const INK = "var(--ink)";
const AMBER = "var(--amber)";
const AMBER_INK = "var(--amber-ink)";
const PAPER = "var(--paper)";

type Box = { x: number; y: number; w: number; h: number };
const BOXES: Box[] = [
  { x: 96, y: 152, w: 72, h: 60 },
  { x: 192, y: 138, w: 84, h: 74 },
  { x: 300, y: 164, w: 62, h: 48 },
];

/** Side view of a flatbed: bed, headboard and wheels. */
function Flatbed() {
  return (
    <g fill="none" stroke={INK} strokeWidth="2" strokeLinejoin="round">
      <rect x="60" y="212" width="352" height="12" fill={PAPER} />
      <rect x="400" y="142" width="12" height="70" fill={PAPER} />
      <circle cx="124" cy="250" r="20" fill={PAPER} />
      <circle cx="174" cy="250" r="20" fill={PAPER} />
      <circle cx="372" cy="250" r="20" fill={PAPER} />
    </g>
  );
}

function Crates({ boxes = BOXES, dashed = false }: { boxes?: Box[]; dashed?: boolean }) {
  return (
    <g
      fill={dashed ? "none" : PAPER}
      stroke={INK}
      strokeWidth={dashed ? 1.5 : 2}
      strokeDasharray={dashed ? "5 5" : undefined}
      strokeLinejoin="round"
    >
      {boxes.map((box) => (
        <rect key={box.x} x={box.x} y={box.y} width={box.w} height={box.h} />
      ))}
    </g>
  );
}

function Straps({ boxes = BOXES }: { boxes?: Box[] }) {
  return (
    <g fill="none" stroke={AMBER} strokeWidth="5" strokeLinejoin="round" strokeLinecap="round">
      {boxes.map((box) => (
        <path
          key={box.x}
          d={`M${box.x - 10} 212 L${box.x + box.w * 0.3} ${box.y - 3} L${box.x + box.w * 0.7} ${box.y - 3} L${box.x + box.w + 10} 212`}
        />
      ))}
    </g>
  );
}

/** Line drawings for the "How it works" steps. Decorative: the step text carries the meaning. */
export function StepVisual({ step }: { step: Step }) {
  return (
    <svg viewBox="0 0 480 320" className="size-full" aria-hidden focusable="false">
      {step === "photo" && (
        <>
          <rect x="150" y="24" width="180" height="272" rx="22" fill={PAPER} stroke={INK} strokeWidth="2" />
          <rect x="164" y="48" width="152" height="196" fill="var(--surface)" stroke={INK} strokeWidth="1.5" />
          <g transform="translate(145 78) scale(0.4)">
            <Flatbed />
            <Crates />
          </g>
          <path d="M176 60h14M176 60v14M304 60h-14M304 60v14M176 232h14M176 232v-14M304 232h-14M304 232v-14" stroke={INK} strokeWidth="2" fill="none" />
          <circle cx="240" cy="270" r="13" fill={PAPER} stroke={INK} strokeWidth="2" />
          <circle cx="240" cy="270" r="7" fill={INK} />
        </>
      )}

      {step === "perceive" && (
        <>
          <Flatbed />
          <Crates />
          <g fill="none" stroke={AMBER_INK} strokeWidth="2" strokeDasharray="6 5">
            {BOXES.map((box) => (
              <rect key={box.x} x={box.x - 8} y={box.y - 8} width={box.w + 16} height={box.h + 16} />
            ))}
          </g>
          {BOXES.map((box, index) => (
            <g key={box.x}>
              <rect x={box.x - 8} y={box.y - 30} width="22" height="20" fill={INK} />
              <text
                x={box.x + 3}
                y={box.y - 15}
                textAnchor="middle"
                fontFamily="var(--font-mono)"
                fontSize="13"
                fill={PAPER}
              >
                {index + 1}
              </text>
            </g>
          ))}
        </>
      )}

      {step === "simulate" && (
        <>
          <Flatbed />
          <Crates dashed />
          <Crates
            boxes={[
              { x: 152, y: 152, w: 72, h: 60 },
              { x: 232, y: 138, w: 84, h: 74 },
              { x: 330, y: 164, w: 62, h: 48 },
            ]}
          />
          <g fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M120 104h200" />
            <path d="M306 92l16 12-16 12" />
          </g>
          <path d="M60 286h80M170 286h50M250 286h30" stroke={INK} strokeWidth="2" strokeLinecap="round" />
        </>
      )}

      {step === "plan" && (
        <>
          <Flatbed />
          <Crates
            boxes={[
              { x: 190, y: 152, w: 72, h: 60 },
              { x: 270, y: 138, w: 84, h: 74 },
              { x: 362, y: 164, w: 36, h: 48 },
            ]}
          />
          <Straps
            boxes={[
              { x: 190, y: 152, w: 72, h: 60 },
              { x: 270, y: 138, w: 84, h: 74 },
            ]}
          />
          <g fill={INK}>
            {[180, 272, 260, 364].map((x) => (
              <circle key={x} cx={x} cy="212" r="4" />
            ))}
          </g>
        </>
      )}

      {step === "certificate" && (
        <>
          <rect x="140" y="24" width="200" height="272" fill={PAPER} stroke={INK} strokeWidth="2" />
          <path d="M164 56h96M164 72h60" stroke={INK} strokeWidth="2" strokeLinecap="round" />
          <rect x="164" y="92" width="152" height="84" fill="var(--surface)" stroke={INK} strokeWidth="1.5" />
          <g transform="translate(146 82) scale(0.38)">
            <Flatbed />
            <Crates />
            <Straps />
          </g>
          <path d="M164 198h152M164 214h152M164 230h104" stroke="var(--control-border)" strokeWidth="2" strokeLinecap="round" />
          <circle cx="180" cy="266" r="13" fill="var(--pass-tint)" stroke="var(--pass)" strokeWidth="2" />
          <path d="M174 266l5 5 8-10" fill="none" stroke="var(--pass)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <text x="204" y="271" fontFamily="var(--font-mono)" fontSize="12" fill={INK}>
            3f9a 7c21 e0b4
          </text>
        </>
      )}
    </svg>
  );
}
