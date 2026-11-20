"use client";

import { useEffect } from "react";

import { REDUCED_MOTION } from "@/lib/use-media-query";

/**
 * Fades `[data-reveal]` blocks up as they enter the viewport.
 *
 * Only blocks that start below the fold are hidden, and only after this script runs, so the
 * page is complete without JavaScript and nothing visible ever flashes.
 */
export function RevealOnScroll() {
  useEffect(() => {
    if (window.matchMedia(REDUCED_MOTION).matches || !("IntersectionObserver" in window)) {
      return;
    }

    const blocks = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]")).filter(
      (block) => block.getBoundingClientRect().top > window.innerHeight,
    );
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("reveal-run");
          entry.target.classList.remove("reveal-pending");
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.05, rootMargin: "0px 0px -8% 0px" },
    );

    for (const block of blocks) {
      block.classList.add("reveal-pending");
      observer.observe(block);
    }
    return () => {
      observer.disconnect();
      for (const block of blocks) block.classList.remove("reveal-pending", "reveal-run");
    };
  }, []);

  return null;
}
