import { AppOrSiteHeader } from "@/components/app/app-nav";
import { SiteHeader } from "@/components/site/site-header";

/**
 * The page header. `full`: the site header, always (pages outside /app, which have no sign-in).
 * `minimal`: pages under /app, where the app header shows once someone is signed in (an account
 * or a demo) and the site header shows for visitors.
 */
export function SiteNav({ variant }: { variant: "full" | "minimal" }) {
  return variant === "full" ? <SiteHeader /> : <AppOrSiteHeader />;
}
