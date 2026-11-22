"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { REDUCED_MOTION } from "@/lib/use-media-query";

/**
 * One short clip of a gallery example, recorded from the realistic replay
 * (`frontend/scripts/record-example-clips.mjs`). Nothing is downloaded until the clip is near
 * the viewport: the poster is a lazy image and the video element only mounts then, and never
 * before the page has finished loading. It plays
 * muted and looped while on screen and the tab is visible, never by itself when the visitor
 * asked for less motion, and has a small play/pause instead of the browser's controls.
 * The clip itself is a link to the same load, live in the explorer.
 */
export function ExampleClip({
  clip,
  href,
  label,
  linkLabel,
}: {
  /** Path without extension: `<clip>.webm`, `<clip>.mp4` and `<clip>.webp` exist. */
  clip: string;
  /** Explorer query of this version. */
  href: string;
  /** Short description of the clip for screen readers. */
  label: string;
  /** Accessible name of the link to the explorer. */
  linkLabel: string;
}) {
  const t = useTranslations("Gallery");
  const frame = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [near, setNear] = useState(false);
  // Videos wait for the page to finish loading, so they never compete with what the visitor sees first.
  const [settled, setSettled] = useState(false);
  const [visible, setVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  // null: follow the visitor's motion setting; true/false: what they chose with the button.
  const [choice, setChoice] = useState<boolean | null>(null);
  const [reduced, setReduced] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    // Mount the video a little before it scrolls in; play only while half of it shows.
    const nearby = new IntersectionObserver(([entry]) => entry?.isIntersecting && setNear(true), {
      rootMargin: "300px 0px",
    });
    const onScreen = new IntersectionObserver(([entry]) => setVisible(Boolean(entry?.isIntersecting)), {
      threshold: 0.5,
    });
    nearby.observe(element);
    onScreen.observe(element);
    const motion = window.matchMedia(REDUCED_MOTION);
    const onMotion = () => setReduced(motion.matches);
    const onPage = () => setPageVisible(document.visibilityState === "visible");
    onMotion();
    onPage();
    let idle = 0;
    const settle = () => {
      idle = window.setTimeout(() => setSettled(true), 1200);
    };
    if (document.readyState === "complete") settle();
    else window.addEventListener("load", settle, { once: true });
    motion.addEventListener("change", onMotion);
    document.addEventListener("visibilitychange", onPage);
    return () => {
      nearby.disconnect();
      onScreen.disconnect();
      motion.removeEventListener("change", onMotion);
      document.removeEventListener("visibilitychange", onPage);
      window.removeEventListener("load", settle);
      window.clearTimeout(idle);
    };
  }, []);

  const wanted = choice ?? !reduced;
  const mounted = near && settled;
  const shouldPlay = mounted && visible && pageVisible && wanted;

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (shouldPlay) void element.play().catch(() => setPlaying(false));
    else element.pause();
  }, [shouldPlay, mounted]);

  return (
    <div ref={frame} className="relative aspect-[16/10] w-full overflow-hidden rounded bg-surface">
      <Link href={`/app/explorer?${href}`} aria-label={linkLabel} className="group absolute inset-0 block">
        {/* The poster first, so the frame never jumps; the video covers it once it has a frame. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- a static WebP, no resizing needed */}
        <img
          src={`${clip}.webp`}
          alt=""
          loading="lazy"
          decoding="async"
          width={960}
          height={600}
          className="absolute inset-0 h-full w-full object-cover"
        />
        {mounted && (
          <video
            ref={video}
            muted
            loop
            playsInline
            preload="auto"
            poster={`${clip}.webp`}
            aria-label={label}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            className="absolute inset-0 h-full w-full object-cover"
          >
            <source src={`${clip}.webm`} type="video/webm" />
            <source src={`${clip}.mp4`} type="video/mp4" />
          </video>
        )}
        <span className="type-label absolute bottom-2 left-2 rounded-full bg-paper/85 px-2.5 py-1 text-ink opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          {t("clip.open")}
        </span>
      </Link>
      <button
        type="button"
        onClick={() => setChoice(!playing)}
        aria-label={playing ? t("clip.pause") : t("clip.play")}
        className="absolute right-1 bottom-1 flex size-11 items-center justify-center sm:size-9"
      >
        <span className="flex size-7 items-center justify-center rounded-full bg-paper/85 text-ink">
          {playing ? (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden fill="currentColor">
              <rect x="1.5" y="1" width="2.5" height="8" rx="0.5" />
              <rect x="6" y="1" width="2.5" height="8" rx="0.5" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden fill="currentColor">
              <path d="M2.5 1.2v7.6a.4.4 0 0 0 .6.35l6.2-3.8a.4.4 0 0 0 0-.7L3.1.85a.4.4 0 0 0-.6.35z" />
            </svg>
          )}
        </span>
      </button>
    </div>
  );
}
