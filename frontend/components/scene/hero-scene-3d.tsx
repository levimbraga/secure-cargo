"use client";

import securedRaw from "@/content/keyframes/braking-secured.json";
import unsecuredRaw from "@/content/keyframes/braking-unsecured.json";
import KeyframePlayer, { type KeyframePlayerProps } from "@/components/scene/keyframe-player";
import { parseKeyframes } from "@/lib/keyframes";

/**
 * The braking scene with its two variants. The documents are hand-made placeholders
 * (see scripts/generate-placeholder-keyframes.mjs) until the physics engine provides real ones.
 */
export const BRAKING_DOCS = {
  unsecured: parseKeyframes(unsecuredRaw),
  secured: parseKeyframes(securedRaw),
};

export type BrakingVariant = keyof typeof BRAKING_DOCS;

export default function HeroScene3d({
  variant,
  ...player
}: { variant: BrakingVariant } & Omit<KeyframePlayerProps, "doc">) {
  return <KeyframePlayer doc={BRAKING_DOCS[variant]} {...player} />;
}
