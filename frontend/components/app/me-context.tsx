"use client";

import { createContext, useContext } from "react";

import type { Me } from "@/lib/app-api";
import type { DemoRole } from "@/lib/demo-session";

/**
 * Who is signed in, as the pages see it. Kept apart from the providers (which load Clerk), so a
 * page without sign-in, such as the landing page, can read it without shipping Clerk.
 */
export type MeState = {
  /** We know whether someone is signed in (a Clerk account or a demo session). */
  ready: boolean;
  signedIn: boolean;
  me: Me | null;
  error: string | null;
  refresh: () => void;
  /** The Clerk session token for API calls; null for a demo visitor (their cookie goes along). */
  getToken: () => Promise<string | null>;
  /** A demo visitor: a Worker-issued session, no account (no Clerk components). */
  demo: boolean;
  /** Start (or switch) a demo session; resolves once the session is in place. */
  enterDemo: (role: DemoRole) => Promise<void>;
  /** End the demo session. */
  exitDemo: () => Promise<void>;
  /** Inside a provider (pages under /app); false on pages without sign-in, such as the landing page. */
  inProvider: boolean;
};

export const noToken = async () => null;

export const MeContext = createContext<MeState>({
  ready: false,
  signedIn: false,
  me: null,
  error: null,
  refresh: () => {},
  getToken: noToken,
  demo: false,
  enterDemo: async () => {},
  exitDemo: async () => {},
  inProvider: false,
});


export function useMe(): MeState {
  return useContext(MeContext);
}
