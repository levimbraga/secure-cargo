/**
 * How close a browser run must be to the server's run of the same live model.
 *
 * MuJoCo WebAssembly is the same engine, version and model as the server's, and WebAssembly
 * arithmetic is deterministic, so in practice the two agree to the last rounded digit (see
 * docs/validation.md). The tolerances below leave room for a different WebAssembly engine or a
 * rebuilt binary without letting a real divergence through.
 */

import type { Status } from "@/lib/demo";

export const PARITY_TOLERANCE = {
  /** Largest slide of any unit: 1 mm, or 1 % when it slides further than 10 cm. */
  slide_m: 0.001,
  slide_relative: 0.01,
  /** Largest tilt of any unit [deg]. */
  tilt_deg: 0.1,
  /** Peak lashing force: 1 % of the server's value, and at least 10 N. */
  force_relative: 0.01,
  force_n: 10,
} as const;

export type ParitySummary = {
  status: Status;
  findings: string[];
  max_slide_m: number;
  max_tilt_deg: number;
  peak_lashing_force_n: number | null;
};

type ResultLike = {
  verdict: { status: Status; findings: { code: string }[] };
  margins: { max_slide_m: number; max_tilt_deg: number; peak_lashing_force_n: number | null };
};

export function paritySummary(result: ResultLike): ParitySummary {
  return {
    status: result.verdict.status,
    findings: result.verdict.findings.map((finding) => finding.code).sort(),
    max_slide_m: result.margins.max_slide_m,
    max_tilt_deg: result.margins.max_tilt_deg,
    peak_lashing_force_n: result.margins.peak_lashing_force_n,
  };
}

/** Differences beyond the tolerance, as readable sentences; empty when the two runs agree. */
export function parityDifferences(browser: ParitySummary, server: ParitySummary): string[] {
  const differences: string[] = [];
  if (browser.status !== server.status) {
    differences.push(`verdict: browser ${browser.status}, server ${server.status}`);
  }
  if (browser.findings.join() !== server.findings.join()) {
    differences.push(`findings: browser [${browser.findings.join(", ")}], server [${server.findings.join(", ")}]`);
  }
  const slideLimit = Math.max(PARITY_TOLERANCE.slide_m, PARITY_TOLERANCE.slide_relative * server.max_slide_m);
  if (Math.abs(browser.max_slide_m - server.max_slide_m) > slideLimit) {
    differences.push(`max slide: browser ${browser.max_slide_m} m, server ${server.max_slide_m} m`);
  }
  // A unit that tumbles off the bed is chaotic; its tilt only has to agree that it fell.
  const tumbled = server.max_tilt_deg > 45 && browser.max_tilt_deg > 45;
  if (!tumbled && Math.abs(browser.max_tilt_deg - server.max_tilt_deg) > PARITY_TOLERANCE.tilt_deg) {
    differences.push(`max tilt: browser ${browser.max_tilt_deg} deg, server ${server.max_tilt_deg} deg`);
  }
  const a = browser.peak_lashing_force_n;
  const b = server.peak_lashing_force_n;
  if ((a === null) !== (b === null)) {
    differences.push(`peak lashing force: browser ${String(a)}, server ${String(b)}`);
  } else if (a !== null && b !== null) {
    const limit = Math.max(PARITY_TOLERANCE.force_n, PARITY_TOLERANCE.force_relative * b);
    if (Math.abs(a - b) > limit) differences.push(`peak lashing force: browser ${a} N, server ${b} N`);
  }
  return differences;
}
