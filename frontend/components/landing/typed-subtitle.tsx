"use client";

import { useEffect, useState } from "react";

import { REDUCED_MOTION, useHydrated, useMediaQuery } from "@/lib/use-media-query";

const MS_PER_CHARACTER = 35;

/**
 * Types the text once, with a caret. The full text is always in the DOM for screen readers and
 * search engines, and it is simply shown when motion is reduced or the script does not run.
 */
export function TypedSubtitle({ text, className }: { text: string; className?: string }) {
  const hydrated = useHydrated();
  const reducedMotion = useMediaQuery(REDUCED_MOTION);
  const [count, setCount] = useState(0);
  const typing = hydrated && !reducedMotion;

  useEffect(() => {
    if (!typing) return;
    const timer = window.setInterval(() => {
      setCount((current) => {
        if (current >= text.length) {
          window.clearInterval(timer);
          return current;
        }
        return current + 1;
      });
    }, MS_PER_CHARACTER);
    return () => window.clearInterval(timer);
  }, [typing, text]);

  return (
    <p className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden className={hydrated ? undefined : "typed-fallback"}>
        {typing ? (
          <>
            <span className="typed-text" data-done={count >= text.length}>
              {text.slice(0, count)}
            </span>
            <span className="invisible">{text.slice(count)}</span>
          </>
        ) : (
          text
        )}
      </span>
    </p>
  );
}
