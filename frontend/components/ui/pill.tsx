import { cva, type VariantProps } from "class-variance-authority";

/** Pill-shaped button styles. Apply to a link or a button. One primary pill per view. */
export const pill = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-medium whitespace-nowrap transition-colors duration-100 select-none disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-ink text-paper hover:bg-ink/85",
        secondary: "bg-surface text-ink hover:bg-hairline",
        // For controls that sit on top of media.
        overlay: "bg-paper text-ink ring-1 ring-hairline hover:bg-surface",
      },
      size: {
        md: "h-11 px-5 text-[1.0625rem]",
        sm: "h-10 px-4 text-[0.9375rem]",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type PillVariants = VariantProps<typeof pill>;
