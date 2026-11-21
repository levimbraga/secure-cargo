import { use } from "react";
import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { SignInPanel } from "@/components/app/sign-in-panel";
import { SiteNav } from "@/components/site/site-nav";
import { routing } from "@/i18n/routing";

/**
 * "Create account" opened first. Invitation emails land here too: the panel reads Clerk's ticket
 * from the query string on the client, so the page stays static.
 */
export default function SignUpPage({ params }: PageProps<"/[locale]/app/sign-up">) {
  const { locale } = use(params);
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return (
    <>
      <SiteNav variant="minimal" />
      <main className="col flex-1 pt-14 pb-24 md:pt-20">
        <SignInPanel initial="sign-up" />
      </main>
    </>
  );
}
