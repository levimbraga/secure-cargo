import { use } from "react";
import { hasLocale, useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { ApiWarmup } from "@/components/api-warmup";
import { HeroScene } from "@/components/landing/hero-scene";
import { HowItWorks } from "@/components/landing/how-it-works";
import { RevealOnScroll } from "@/components/landing/reveal-on-scroll";
import { Scenarios } from "@/components/landing/scenarios";
import { Stats } from "@/components/landing/stats";
import { TypedSubtitle } from "@/components/landing/typed-subtitle";
import { SiteNav } from "@/components/site/site-nav";
import { pill } from "@/components/ui/pill";
import { SectionLabel } from "@/components/ui/section-label";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

export default function LandingPage({ params }: PageProps<"/[locale]">) {
  const { locale } = use(params);
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = useTranslations("Landing");

  return (
    <>
      <SiteNav variant="full" />
      <ApiWarmup />
      <RevealOnScroll />

      <main className="flex-1">
        <section className="shell pt-14 pb-20 md:pt-24 md:pb-28">
          <h1 className="type-display max-w-[16ch] text-balance">
            {t("hero.title")}
          </h1>
          <TypedSubtitle
            text={t("hero.subtitle")}
            className="type-lead mt-6 max-w-reading text-muted-foreground"
          />
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/app" className={pill()}>
              {t("hero.primary")}
            </Link>
            <Link href="/#how-it-works" className={pill({ variant: "secondary" })}>
              {t("hero.secondary")}
            </Link>
          </div>
          <HeroScene className="mt-12 md:mt-16" />
        </section>

        <Stats />

        <section id="problem" className="border-t border-hairline">
          <div className="shell section-y" data-reveal>
            <SectionLabel>{t("problem.label")}</SectionLabel>
            <h2 className="type-h2 mt-3 max-w-[22ch] text-balance">{t("problem.title")}</h2>
            <div className="mt-8 flex max-w-reading flex-col gap-5">
              <p>{t("problem.p1")}</p>
              <p>{t("problem.p2")}</p>
              <p>{t("problem.p3")}</p>
            </div>
          </div>
        </section>

        <section id="how-it-works" className="border-t border-hairline">
          <div className="shell section-y" data-reveal>
            <SectionLabel>{t("how.label")}</SectionLabel>
            <h2 className="type-h2 mt-3 max-w-[22ch] text-balance">{t("how.title")}</h2>
            <HowItWorks />
          </div>
        </section>

        <section id="demo" className="border-t border-hairline">
          <div className="shell section-y" data-reveal>
            <SectionLabel>{t("demo.label")}</SectionLabel>
            <h2 className="type-h2 mt-3 max-w-[22ch] text-balance">{t("demo.title")}</h2>
            <Scenarios />
          </div>
        </section>
      </main>
    </>
  );
}
