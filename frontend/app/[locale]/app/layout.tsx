import { ClerkProvider } from "@clerk/nextjs";
import { ptBR } from "@clerk/localizations";

import { MeProvider, SignedOutMeProvider } from "@/components/app/me-provider";
import { AUTH_ENABLED } from "@/lib/auth-config";

/**
 * Everything under /app knows who is signed in. Clerk loads only here, not on the landing page.
 * The API is the only authority on roles; the pages ask it through `MeProvider`.
 */
export default async function AppLayout({ children, params }: LayoutProps<"/[locale]/app">) {
  const { locale } = await params;
  // The app's pages fill at least the screen, so the footer starts below it and does not jump
  // down when signed-in content arrives (it was most of the pages' layout shift).
  const page = <div className="flex min-h-svh flex-col">{children}</div>;
  if (!AUTH_ENABLED) return <SignedOutMeProvider>{page}</SignedOutMeProvider>;
  const prefix = locale === "pt-BR" ? "/pt-BR" : "";
  return (
    <ClerkProvider
      localization={locale === "pt-BR" ? ptBR : undefined}
      signInUrl={`${prefix}/app/sign-in`}
      signUpUrl={`${prefix}/app/sign-up`}
      signInFallbackRedirectUrl={`${prefix}/app`}
      signUpFallbackRedirectUrl={`${prefix}/app`}
      afterSignOutUrl={`${prefix}/app/sign-in`}
      appearance={{
        // Clerk's own "Delete account" (profile, danger zone) would leave our records behind: the
        // account menu's "Delete my account" calls DELETE /me instead, which also deletes in Clerk.
        elements: { profileSection__danger: { display: "none" } },
        variables: {
          colorPrimary: "#191918",
          colorForeground: "#191918",
          colorMutedForeground: "#636361",
          colorBackground: "#F8F8F3",
          colorInput: "#FFFFFF",
          colorDanger: "#B42318",
          colorSuccess: "#136F33",
          borderRadius: "4px",
          fontFamily: "var(--font-inter), system-ui, sans-serif",
        },
      }}
    >
      <MeProvider>{page}</MeProvider>
    </ClerkProvider>
  );
}
