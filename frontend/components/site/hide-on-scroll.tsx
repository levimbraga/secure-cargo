"use client";

import { cn } from "cn";
import { useEffect, useRef, useState } from "react";

/** Below this scroll position the header always shows. */
export const HIDE_AFTER_PX = 80;
/** Ignore scroll steps smaller than this (touch jitter, iOS bounce). */
const JITTER_PX = 4;

/**
 * Whether the header should be hidden after a scroll from `previous` to `current`, given whether it
 * was hidden and whether it must stay (focus inside it, or its menu open).
 */
export function nextHidden(previous: number, current: number, hidden: boolean, pinned: boolean): boolean {
  if (pinned || current <= HIDE_AFTER_PX) return false;
  const delta = current - previous;
  if (Math.abs(delta) < JITTER_PX) return hidden;
  return delta > 0;
}

/**
 * The sticky header that slides up out of view while the page scrolls down (after 80 px) and back in
 * as soon as it scrolls up. It keeps its place in the flow, so nothing below it moves (no layout
 * shift): only a transform changes. It stays while keyboard focus is inside it or a menu in it is
 * open (any `aria-expanded="true"` control). Reduced motion: it shows and hides without sliding.
 */
export function HideOnScroll({ className, children }: { className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const header = ref.current;
    if (!header) return;
    let last = window.scrollY;
    let frame = 0;
    let isHidden = false;

    const focused = () => {
      try {
        return header.matches(":has(:focus-visible)");
      } catch {
        return header.contains(document.activeElement); // browsers without :has()
      }
    };
    const pinned = () => Boolean(header.querySelector('[aria-expanded="true"]')) || focused();

    const update = (value: boolean) => {
      if (value === isHidden) return;
      isHidden = value;
      setHidden(value);
    };

    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const current = Math.max(0, window.scrollY);
        const next = nextHidden(last, current, isHidden, pinned());
        if (Math.abs(current - last) >= JITTER_PX || current <= HIDE_AFTER_PX) last = current;
        update(next);
      });
    };
    // Keyboard focus moving into a hidden header brings it back; a menu opening keeps it.
    const show = () => update(false);
    const observer = new MutationObserver(() => pinned() && update(false));

    window.addEventListener("scroll", onScroll, { passive: true });
    header.addEventListener("focusin", show);
    observer.observe(header, { subtree: true, attributes: true, attributeFilter: ["aria-expanded"] });
    return () => {
      window.removeEventListener("scroll", onScroll);
      header.removeEventListener("focusin", show);
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <header
      ref={ref}
      data-hidden={hidden ? "true" : undefined}
      className={cn(
        "sticky top-0 z-40 transition-transform duration-200 ease-out motion-reduce:transition-none",
        hidden && "-translate-y-full",
        className,
      )}
    >
      {children}
    </header>
  );
}
