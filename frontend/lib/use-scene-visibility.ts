import { type RefObject, useEffect, useRef, useState, useSyncExternalStore } from "react";

function subscribeToPage(onChange: () => void): () => void {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

/** Whether the tab is visible. `true` on the server and during hydration. */
export function usePageVisible(): boolean {
  return useSyncExternalStore(
    subscribeToPage,
    () => !document.hidden,
    () => true,
  );
}

export type SceneVisibility = {
  /** The frame has been in or near the viewport at least once: time to create the canvas. */
  seen: boolean;
  /** Some of the frame is in the viewport now. */
  inView: boolean;
  /** Enough of the frame is in the viewport to count as being watched. */
  onScreen: boolean;
  /** The tab is visible. */
  pageVisible: boolean;
  /** Draw frames and advance clocks: some of the frame is in the viewport and the tab is visible. */
  active: boolean;
};

export type SceneVisibilityOptions = {
  /** How far outside the viewport the frame already counts as near (a CSS margin). */
  margin?: string;
  /** Share of the frame that has to be in the viewport for `onScreen`. */
  threshold?: number;
  /** Called from the observer whenever `onScreen` changes, before React re-renders. */
  onScreenChange?: (onScreen: boolean) => void;
};

/**
 * Visibility of a 3D scene's frame, for the mobile performance budget: create the canvas only
 * once the frame is in or near the viewport (`seen`), and draw only while some of it is on
 * screen and the tab is visible (`active`).
 */
export function useSceneVisibility(
  target: RefObject<Element | null>,
  { margin = "200px 0px", threshold = 0.35, onScreenChange }: SceneVisibilityOptions = {},
): SceneVisibility {
  const [seen, setSeen] = useState(false);
  const [inView, setInView] = useState(false);
  const [onScreen, setOnScreen] = useState(false);
  const pageVisible = usePageVisible();
  const notify = useRef(onScreenChange);
  useEffect(() => {
    notify.current = onScreenChange;
  });

  useEffect(() => {
    const node = target.current;
    if (!node) return;
    // One observer looks ahead of the viewport, the other measures what is really on screen.
    const ahead = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setSeen(true);
      },
      { rootMargin: margin },
    );
    const watched = new IntersectionObserver(
      ([entry]) => {
        const visible = Boolean(entry?.isIntersecting);
        const enough = visible && (entry?.intersectionRatio ?? 0) >= threshold;
        setInView(visible);
        setOnScreen(enough);
        notify.current?.(enough);
      },
      { threshold: [0, threshold] },
    );
    ahead.observe(node);
    watched.observe(node);
    return () => {
      ahead.disconnect();
      watched.disconnect();
    };
  }, [target, margin, threshold]);

  return { seen, inView, onScreen, pageVisible, active: inView && pageVisible };
}
