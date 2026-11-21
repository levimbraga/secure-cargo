"use client";

/**
 * The guided camera: the phone's rear camera full screen, with a dashed truck silhouette to fit
 * the truck in ("full side" or "rear three-quarter"), and a shutter. Where the browser has no
 * camera access (or the driver refuses it), the system camera / file picker opens instead.
 */

import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";

import { pill } from "@/components/ui/pill";
import type { Shot } from "@/lib/inspection/use-flow";

const ACCEPT = "image/jpeg,image/png,image/heic,image/heif,.heic,.heif";

/** Our own outline of a truck: from the side, or from behind one corner. */
export function Silhouette({ shot, className }: { shot: Shot; className?: string }) {
  return shot === "side" ? (
    <svg viewBox="0 0 320 120" className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeDasharray="6 5" aria-hidden>
      <path d="M20 92V44h30l14-18h34v66" />
      <path d="M104 92V30h196v62" />
      <path d="M12 92h300" strokeDasharray="none" strokeWidth={1} opacity={0.6} />
      <circle cx="58" cy="94" r="11" />
      <circle cx="230" cy="94" r="11" />
      <circle cx="258" cy="94" r="11" />
    </svg>
  ) : (
    <svg viewBox="0 0 240 160" className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeDasharray="6 5" aria-hidden>
      {/* The rear end, square to the camera, and the side going away to the right. */}
      <path d="M30 120V40h80v80" />
      <path d="M110 40l100-22v78l-100 24" />
      <path d="M30 40l100-22h80" />
      <circle cx="48" cy="126" r="10" />
      <circle cx="94" cy="126" r="10" />
      <circle cx="176" cy="108" r="8" />
      <path d="M10 140h220" strokeDasharray="none" strokeWidth={1} opacity={0.6} />
    </svg>
  );
}

export function GuidedCamera({ shot, onPhoto, onClose }: { shot: Shot; onPhoto: (file: File) => void; onClose: () => void }) {
  const t = useTranslations("Driver.capture");
  const video = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const fileId = useId();

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("no camera API");
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) return;
        if (video.current) {
          video.current.srcObject = stream;
          await video.current.play().catch(() => undefined);
          setReady(true);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      for (const track of stream?.getTracks() ?? []) track.stop();
    };
  }, []);

  const shoot = () => {
    const element = video.current;
    if (!element || !element.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = element.videoWidth;
    canvas.height = element.videoHeight;
    canvas.getContext("2d")?.drawImage(element, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (blob) onPhoto(new File([blob], `${shot}.jpg`, { type: "image/jpeg" }));
      },
      "image/jpeg",
      0.92,
    );
  };

  return (
    <div role="dialog" aria-modal="true" aria-label={t(`shots.${shot}.title`)} className="fixed inset-0 z-50 flex flex-col bg-ink text-paper" data-testid="guided-camera">
      <div className="flex items-center justify-between px-4 pt-[max(env(safe-area-inset-top),1rem)] pb-3">
        <p className="text-[0.9375rem] font-[450]">{t(`shots.${shot}.title`)}</p>
        <button type="button" onClick={onClose} className="h-11 rounded-full px-4 text-[0.9375rem] text-paper/80 hover:text-paper" aria-label={t("close")}>
          {t("close")}
        </button>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {!failed && <video ref={video} playsInline muted className="absolute inset-0 size-full object-cover" />}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
          <Silhouette shot={shot} className="w-full max-w-md text-paper/90 drop-shadow" />
        </div>
        <p className="absolute inset-x-0 bottom-4 px-6 text-center text-[0.9375rem] text-paper">{failed ? t("noCamera") : t(`shots.${shot}.hint`)}</p>
      </div>
      <div className="flex items-center justify-center gap-6 px-4 pt-4 pb-[max(env(safe-area-inset-bottom),1.25rem)]">
        <label htmlFor={fileId} className={pill({ variant: "secondary", className: "h-12 cursor-pointer px-5" })}>
          {failed ? t("openCamera") : t("upload")}
        </label>
        <input
          id={fileId}
          type="file"
          accept={failed ? "image/*" : ACCEPT}
          capture={failed ? "environment" : undefined}
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onPhoto(file);
            event.target.value = "";
          }}
        />
        {!failed && (
          <button
            type="button"
            onClick={shoot}
            disabled={!ready}
            aria-label={t("shutter")}
            data-testid="shutter"
            className="size-[72px] rounded-full border-4 border-paper bg-paper/20 disabled:opacity-40"
          />
        )}
      </div>
    </div>
  );
}
