"use client";

import { useAuth } from "@clerk/nextjs";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { type Me, useAppApi } from "@/lib/app-api";

type MeState = {
  /** Clerk has loaded and knows whether someone is signed in. */
  ready: boolean;
  signedIn: boolean;
  me: Me | null;
  error: string | null;
  refresh: () => void;
};

const MeContext = createContext<MeState>({
  ready: false,
  signedIn: false,
  me: null,
  error: null,
  refresh: () => {},
});

/** Who is signed in, their organization, role and analysis allowance, from the API's `/me`. */
export function MeProvider({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn, orgId, userId } = useAuth();
  const request = useAppApi();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    let cancelled = false;
    request<Me>("/me")
      .then((value) => {
        if (!cancelled) {
          setMe(value);
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
    // Re-read when the user or the active organization changes.
  }, [isLoaded, isSignedIn, userId, orgId, version, request]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const signedIn = Boolean(isLoaded && isSignedIn);

  return (
    <MeContext.Provider
      value={{ ready: isLoaded && (!signedIn || me !== null || error !== null), signedIn, me: signedIn ? me : null, error, refresh }}
    >
      {children}
    </MeContext.Provider>
  );
}

export function useMe(): MeState {
  return useContext(MeContext);
}
