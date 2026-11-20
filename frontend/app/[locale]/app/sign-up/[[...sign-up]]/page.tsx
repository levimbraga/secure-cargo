import { use } from "react";
import { SignUp } from "@clerk/nextjs";
import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { SiteNav } from "@/components/site/site-nav";
import { routing } from "@/i18n/routing";

/** Where invitation emails land: Clerk reads the invitation ticket from the URL. */
export default function SignUpPage({ params }: PageProps<"/[locale]/app/sign-up/[[...sign-up]]">) {
  const { locale } = use(params);
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const prefix = locale === "pt-BR" ? "/pt-BR" : "";
  return (
    <>
      <SiteNav variant="minimal" />
      <main className="col flex-1 pt-14 pb-24 md:pt-20">
        <SignUp routing="path" path={`${prefix}/app/sign-up`} signInUrl={`${prefix}/app/sign-in`} />
      </main>
    </>
  );
}
