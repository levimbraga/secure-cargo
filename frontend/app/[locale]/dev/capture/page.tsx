import { notFound } from "next/navigation";

import { CaptureStage } from "@/components/scene/capture-stage";

/**
 * Development-only page used by scripts/render-media.mjs to render the poster, the mobile video
 * and the scenario stills from the 3D scene. It does not exist in production builds.
 */
export default function CapturePage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <CaptureStage />;
}
