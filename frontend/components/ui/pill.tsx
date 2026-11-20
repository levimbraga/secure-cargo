import { cva, type VariantProps } from "class-variance-authority";

/** Small pill-shaped button styles. Apply to a link or a button. One primary pill per view. */
export const pill = cva(
  "inline-flex h-8 shrink-0 items-center justify-center rounded-full px-3 text-sm font-[450] whitespace-nowrap transition-colors duration-100 select-none disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-ink text-paper hover:bg-ink/85",
        secondary: "bg-surface text-ink hover:bg-hairline",
      },
    },
    defaultVariants: { variant: "primary" },
  },
);

export type PillVariants = VariantProps<typeof pill>;
