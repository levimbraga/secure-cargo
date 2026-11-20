"use client";

import { cn } from "cn";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import { type Step, STEPS, StepVisual } from "@/components/landing/step-visual";

/** Five-step accordion. One step is always open; its drawing sits beside it on wide screens. */
export function HowItWorks() {
  const t = useTranslations("Landing.how");
  const [open, setOpen] = useState<Step>("photo");
  const baseId = useId();

  return (
    <div className="mt-12 grid gap-x-16 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <ol className="border-b border-hairline">
        {STEPS.map((step, index) => {
          const isOpen = step === open;
          const buttonId = `${baseId}-${step}-button`;
          const panelId = `${baseId}-${step}-panel`;
          return (
            <li key={step} className="border-t border-hairline">
              <h3>
                <button
                  type="button"
                  id={buttonId}
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => setOpen(step)}
                  className="flex w-full items-center gap-5 py-5 text-left"
                >
                  <span className="w-5 font-mono text-sm text-muted-foreground tabular-nums">
                    {index + 1}
                  </span>
                  <span className="type-h3 flex-1">{t(`steps.${step}.title`)}</span>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    aria-hidden
                  >
                    <path d="M2 8h12" />
                    {!isOpen && <path d="M8 2v12" />}
                  </svg>
                </button>
              </h3>
              <div
                id={panelId}
                role="region"
                aria-labelledby={buttonId}
                className={cn(
                  "grid transition-[grid-template-rows] duration-[240ms] ease-out motion-reduce:transition-none",
                  isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                )}
              >
                <div className={cn("overflow-hidden", !isOpen && "invisible")}>
                  <p className="max-w-reading pr-6 pb-6 pl-10">{t(`steps.${step}.body`)}</p>
                  <div className="mb-6 ml-10 aspect-[3/2] rounded-xl border border-hairline bg-surface md:hidden">
                    <StepVisual step={step} />
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="hidden md:block">
        <div className="sticky top-24 aspect-[3/2] rounded-xl border border-hairline bg-surface">
          <div key={open} className="fade-in size-full">
            <StepVisual step={open} />
          </div>
        </div>
      </div>
    </div>
  );
}
