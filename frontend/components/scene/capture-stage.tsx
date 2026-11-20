"use client";

import { useEffect, useRef, useState } from "react";

import HeroScene3d, { BRAKING_DOCS, type BrakingVariant } from "@/components/scene/hero-scene-3d";
import type { CameraView } from "@/components/scene/keyframe-player";

declare global {
  interface Window {
    __capture?: { seek: (seconds: number) => void; duration: number };
  }
}

type Setup = { variant: BrakingVariant; view: CameraView; width: number; height: number };

/** Renders one variant of the scene at a fixed size and lets a script step through time. */
export function CaptureStage() {
  const time = useRef(0);
  const [setup, setSetup] = useState<Setup | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const variant = params.get("variant") === "secured" ? "secured" : "unsecured";
    const next: Setup = {
      variant,
      view: (params.get("view") as CameraView | null) ?? "hero",
      width: Number(params.get("w") ?? 1600),
      height: Number(params.get("h") ?? 900),
    };
    window.__capture = {
      seek: (seconds) => {
        time.current = seconds;
      },
      duration: BRAKING_DOCS[variant].duration_s,
    };
    // Reading the query string is only possible in the browser, after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSetup(next);
  }, []);

  if (!setup) return null;

  return (
    <div
      id="capture-stage"
      className="fixed top-0 left-0 z-50 bg-surface"
      style={{ width: setup.width, height: setup.height }}
    >
      <HeroScene3d
        variant={setup.variant}
        view={setup.view}
        controlledTime={time}
        onReady={() => {
          document.body.dataset.captureReady = "true";
        }}
      />
    </div>
  );
}
