"use client";

import { Component, type ReactNode } from "react";

/** Whether this browser can create a WebGL context at all. */
export function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

/**
 * Keeps a failure of the 3D scene inside its frame: the sentence, the verdict and the numbers
 * around it do not depend on WebGL and must stay on the page.
 */
export class ReplayBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
