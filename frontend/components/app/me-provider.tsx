"use client";

import { useAuth } from "@clerk/nextjs";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { type Me, requestWithToken } from "@/lib/app-api";

type MeState = {
  /** Clerk has loaded and knows whether someone is signed in. */
  ready: boolean;
  signedIn: boolean;
  me: Me | null;
  error: string | null;
  refresh: () => void;
  /** The session token for API calls (null when signed out or when sign-in is off). */
  getToken: () => Promise<string | null>;
};

const MeContext = createContext<MeState>({
  ready: false,
  signedIn: false,
  me: null,
  error: null,
  refresh: () => {},
  getToken: async () => null,
});

/** Sign-in is off (no Clerk keys): everyone is signed out. */
export function SignedOutMeProvider({ children }: { children: React.ReactNode }) {
  return (
    <MeContext.Provider value={{ ready: true, signedIn: false, me: null, error: null, refresh: () => {}, getToken: async () => null }}>
      {children}
    </MeContext.Provider>
  );
}

/** Who is signed in, their organization, role and analysis allowance, from the API's `/me`. */
export function MeProvider({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn, orgId, userId, getToken } = useAuth();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    let cancelled = false;
    requestWithToken<Me>(getToken, "/me")
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
  }, [isLoaded, isSignedIn, userId, orgId, version, getToken]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const signedIn = Boolean(isLoaded && isSignedIn);

  return (
    <MeContext.Provider
      value={{
        ready: isLoaded && (!signedIn || me !== null || error !== null),
        signedIn,
        me: signedIn ? me : null,
        error,
        refresh,
        getToken,
      }}
    >
      {children}
    </MeContext.Provider>
  );
}

export function useMe(): MeState {
  return useContext(MeContext);
}
