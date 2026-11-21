"use client";

import { useAuth, useOrganizationList } from "@clerk/nextjs";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { API_URL } from "@/lib/api";
import { type Me, readError, requestWithToken } from "@/lib/app-api";

export type DemoRole = "driver" | "insurer";

type MeState = {
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
};

const noToken = async () => null;

const MeContext = createContext<MeState>({
  ready: false,
  signedIn: false,
  me: null,
  error: null,
  refresh: () => {},
  getToken: noToken,
  demo: false,
  enterDemo: async () => {},
  exitDemo: async () => {},
});

/**
 * The demo session, if any: the Worker's httpOnly cookie, so the page asks `/me` to know.
 * `undefined` while checking, `null` when there is none.
 */
function useDemoSession(enabled: boolean) {
  const [demoMe, setDemoMe] = useState<Me | null | undefined>(undefined);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    requestWithToken<Me>(noToken, "/me")
      .then((value) => !cancelled && setDemoMe(value.user.is_demo ? value : null))
      .catch(() => !cancelled && setDemoMe(null));
    return () => {
      cancelled = true;
    };
  }, [enabled, version]);

  const enterDemo = useCallback(async (role: DemoRole) => {
    const response = await fetch(`${API_URL}/demo/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ as: role }),
      credentials: "include",
    });
    if (!response.ok) throw await readError(response);
    const me = await requestWithToken<Me>(noToken, "/me");
    setDemoMe(me);
  }, []);

  const exitDemo = useCallback(async () => {
    await fetch(`${API_URL}/demo/logout`, { method: "POST", credentials: "include" }).catch(() => undefined);
    setDemoMe(null);
  }, []);

  return { demoMe, enterDemo, exitDemo, refreshDemo: useCallback(() => setVersion((v) => v + 1), []) };
}

/** Sign-in is off (no Clerk keys): only the demo session can sign anyone in. */
export function SignedOutMeProvider({ children }: { children: React.ReactNode }) {
  const { demoMe, enterDemo, exitDemo, refreshDemo } = useDemoSession(true);
  return (
    <MeContext.Provider
      value={{
        ready: demoMe !== undefined,
        signedIn: Boolean(demoMe),
        me: demoMe ?? null,
        error: null,
        refresh: refreshDemo,
        getToken: noToken,
        demo: Boolean(demoMe),
        enterDemo,
        exitDemo,
      }}
    >
      {children}
    </MeContext.Provider>
  );
}

/** Who is signed in, their organization, role and analysis allowance, from the API's `/me`. */
export function MeProvider({ children }: { children: React.ReactNode }) {
  // A new account with no organization has a "pending" session (Clerk's choose-organization
  // task). It is signed in for us: `/app` shows the "invited / create my company" choice.
  const { isLoaded, isSignedIn, orgId, userId, getToken } = useAuth({ treatPendingAsSignedOut: false });
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const clerkSignedIn = Boolean(isLoaded && isSignedIn);
  // A real account wins over a demo session left in the browser.
  const { demoMe, enterDemo, exitDemo, refreshDemo } = useDemoSession(isLoaded && !isSignedIn);

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

  const refresh = useCallback(() => {
    setVersion((v) => v + 1);
    refreshDemo();
  }, [refreshDemo]);
  const demo = !clerkSignedIn && Boolean(demoMe);

  return (
    <MeContext.Provider
      value={{
        ready: isLoaded && (clerkSignedIn ? me !== null || error !== null : demoMe !== undefined),
        signedIn: clerkSignedIn || demo,
        me: clerkSignedIn ? me : (demoMe ?? null),
        error: clerkSignedIn ? error : null,
        refresh,
        getToken: clerkSignedIn ? getToken : noToken,
        demo,
        enterDemo,
        exitDemo,
      }}
    >
      {clerkSignedIn && !orgId && <ActivateMembership />}
      {children}
    </MeContext.Provider>
  );
}

/**
 * Signed in with no active organization but a member of one (an accepted invitation, or a new
 * sign-in): make it the active one, so that the session token carries it and the API sees it.
 */
function ActivateMembership() {
  const { isLoaded, setActive, userMemberships } = useOrganizationList({ userMemberships: true });
  const first = userMemberships?.data?.[0]?.organization.id;
  useEffect(() => {
    if (isLoaded && first) void setActive?.({ organization: first });
  }, [isLoaded, first, setActive]);
  return null;
}

export function useMe(): MeState {
  return useContext(MeContext);
}
