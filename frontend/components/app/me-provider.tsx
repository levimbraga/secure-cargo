"use client";

import { useAuth, useOrganizationList } from "@clerk/nextjs";
import { useCallback, useEffect, useState } from "react";

import { type Me, requestWithToken } from "@/lib/app-api";
import { type DemoRole, endDemoSession, startDemoSession } from "@/lib/demo-session";

import { MeContext, noToken } from "@/components/app/me-context";

export type { DemoRole };
export { useMe } from "@/components/app/me-context";

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
    setDemoMe(await startDemoSession(role));
  }, []);

  const exitDemo = useCallback(async () => {
    await endDemoSession();
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
        inProvider: true,
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
        inProvider: true,
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

