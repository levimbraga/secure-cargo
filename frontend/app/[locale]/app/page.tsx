import { use } from "react";
import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { MemberHome } from "@/components/app/member-home";
import { SiteNav } from "@/components/site/site-nav";
import { routing } from "@/i18n/routing";

/** The driver's home (mobile-first); signed out, the sign-in screen with the demo buttons. */
export default function AppPage({ params }: PageProps<"/[locale]/app">) {
  const { locale } = use(params);
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  return (
    <>
      <SiteNav variant="minimal" />
      <main className="col flex-1 pt-14 pb-24 md:pt-20">
        <MemberHome />
      </main>
    </>
  );
}
