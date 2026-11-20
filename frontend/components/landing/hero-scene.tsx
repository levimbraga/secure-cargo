"use client";

import { cn } from "cn";
import { useTranslations } from "next-intl";
import { Component, lazy, type ReactNode, Suspense, useCallback, useEffect, useRef, useState } from "react";

import { pill } from "@/components/ui/pill";
import { REDUCED_MOTION, useHydrated, useMediaQuery } from "@/lib/use-media-query";

// three.js and React Three Fiber live in this chunk and load on demand only.
const HeroScene3d = lazy(() => import("@/components/scene/hero-scene-3d"));

type Variant = "unsecured" | "secured";
const VARIANTS: Variant[] = ["unsecured", "secured"];

/** Phones and other touch-first devices get the looping video instead of the 3D scene. */
const SMALL_OR_TOUCH = "(max-width: 767px), (pointer: coarse)";

const MEDIA = {
  unsecured: {
    posterWide: "/media/hero-unsecured-wide.webp",
    posterMobile: "/media/hero-unsecured-mobile.webp",
    webm: "/media/hero-unsecured.webm",
    mp4: "/media/hero-unsecured.mp4",
  },
  secured: {
    posterWide: "/media/hero-secured-wide.webp",
    posterMobile: "/media/hero-secured-mobile.webp",
    webm: "/media/hero-secured.webm",
    mp4: "/media/hero-secured.mp4",
  },
} as const;

/** The 3D scene is an optimization: if it fails to load or WebGL is missing, keep the poster. */
class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function HeroScene({ className }: { className?: string }) {
  const t = useTranslations("Landing.scene");
  const hydrated = useHydrated();
  const reducedMotion = useMediaQuery(REDUCED_MOTION);
  const smallOrTouch = useMediaQuery(SMALL_OR_TOUCH);

  const frame = useRef<HTMLDivElement>(null);
  const [variant, setVariant] = useState<Variant>("unsecured");
  const [inView, setInView] = useState(false);
  const [everInView, setEverInView] = useState(false);
  const [requested3d, setRequested3d] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [explored, setExplored] = useState(false);
  const [replayToken, setReplayToken] = useState(0);

  useEffect(() => {
    const node = frame.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        const visible = Boolean(entry?.isIntersecting);
        setInView(visible);
        if (visible) {
          // Leave the main thread to the first paint before loading media.
          const idle = window.requestIdleCallback ?? ((run: () => void) => window.setTimeout(run, 200));
          idle(() => setEverInView(true));
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const ready = hydrated && everInView;
  const show3d = ready && (smallOrTouch ? requested3d : true);
  const showVideo = ready && smallOrTouch && !requested3d && !reducedMotion;
  const media = MEDIA[variant];

  const onReady = useCallback(() => setSceneReady(true), []);
  const onInteract = useCallback(() => setExplored(true), []);

  function selectByKey(event: React.KeyboardEvent) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = variant === "unsecured" ? "secured" : "unsecured";
    setVariant(next);
    document.getElementById(`scene-variant-${next}`)?.focus();
  }

  return (
    <figure className={className}>
      <div
        ref={frame}
        className="relative aspect-[4/3] overflow-hidden rounded-xl border border-hairline bg-surface md:aspect-[16/9]"
      >
        {/* Poster: a render of our own scene. Stays under the video and the 3D canvas. */}
        <picture>
          <source media="(min-width: 768px)" srcSet={media.posterWide} width={1600} height={900} />
          {/* A plain <img> so the phone poster shares its URL with the video's `poster`. */}
          <img
            src={media.posterMobile}
            width={800}
            height={600}
            alt={t(`posterAlt.${variant}`)}
            fetchPriority="high"
            decoding="async"
            className={cn("absolute inset-0 size-full object-cover", show3d && sceneReady && "invisible")}
          />
        </picture>

        {showVideo && (
          <video
            key={variant}
            className="absolute inset-0 size-full object-cover"
            poster={media.posterMobile}
            muted
            autoPlay
            playsInline
            loop
            preload="auto"
            disablePictureInPicture
            disableRemotePlayback
            aria-hidden
            tabIndex={-1}
          >
            <source src={media.webm} type="video/webm" />
            <source src={media.mp4} type="video/mp4" />
          </video>
        )}

        {show3d && (
          <SceneBoundary>
            <Suspense fallback={null}>
              <div className="absolute inset-0 cursor-grab active:cursor-grabbing">
                <HeroScene3d
                  variant={variant}
                  active={inView}
                  autoPlay={!reducedMotion}
                  replayToken={replayToken}
                  onReady={onReady}
                  onInteract={onInteract}
                />
              </div>
            </Suspense>
          </SceneBoundary>
        )}

        {/* Controls */}
        <div
          role="radiogroup"
          aria-label={t("toggleLabel")}
          onKeyDown={selectByKey}
          className="absolute top-3 left-3 flex rounded-full bg-paper p-1 ring-1 ring-control md:top-4 md:left-4"
        >
          {VARIANTS.map((option) => {
            const selected = option === variant;
            return (
              <button
                key={option}
                id={`scene-variant-${option}`}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => setVariant(option)}
                className={cn(
                  "h-9 rounded-full px-3.5 text-[0.9375rem] font-medium transition-colors duration-100",
                  selected ? "bg-ink text-paper" : "text-ink hover:bg-surface",
                )}
              >
                {t(option)}
              </button>
            );
          })}
        </div>

        <p className="type-label absolute bottom-3 left-3 rounded-full bg-paper px-3 py-1.5 text-ink ring-1 ring-hairline md:bottom-4 md:left-4">
          {t("illustration")}
        </p>

        <div className="absolute right-3 bottom-3 flex items-center gap-2 md:right-4 md:bottom-4">
          {show3d && sceneReady && !explored && (
            <p className="type-small hidden rounded-full bg-paper px-3 py-1.5 ring-1 ring-hairline md:block">
              {t("explore")}
            </p>
          )}
          {show3d && sceneReady && (
            <button
              type="button"
              onClick={() => setReplayToken((token) => token + 1)}
              className={pill({ variant: "overlay", size: "sm" })}
            >
              {reducedMotion ? t("play") : t("replay")}
            </button>
          )}
          {ready && smallOrTouch && !requested3d && (
            <button
              type="button"
              onClick={() => setRequested3d(true)}
              className={pill({ variant: "overlay", size: "sm" })}
            >
              {t("explore3d")}
            </button>
          )}
        </div>
      </div>

      <figcaption aria-live="polite" className="mt-4 max-w-reading text-muted-foreground">
        {t(`captions.${variant}`)}
      </figcaption>
    </figure>
  );
}
