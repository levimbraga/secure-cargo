import { use } from "react";
import { Activity, Camera, FileCheck, ListChecks } from "lucide-react";
import Image from "next/image";
import { hasLocale, useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { ApiWarmup } from "@/components/api-warmup";
import { RevealOnScroll } from "@/components/landing/reveal-on-scroll";
import { Scenarios } from "@/components/landing/scenarios";
import { TypedSubtitle } from "@/components/landing/typed-subtitle";
import { SiteNav } from "@/components/site/site-nav";
import { pill } from "@/components/ui/pill";
import { SectionLabel } from "@/components/ui/section-label";
import { Link } from "@/i18n/navigation";
import { DEMO_SAMPLE } from "@/lib/inspection/samples";
import { routing } from "@/i18n/routing";
import dockPhoto from "@/public/media/dock.jpg";
import heroPhoto from "@/public/media/hero.jpg";

const STEPS = [
  { id: "photo", icon: Camera },
  { id: "simulation", icon: Activity },
  { id: "plan", icon: ListChecks },
  { id: "certificate", icon: FileCheck },
] as const;

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
        <section className="col pt-14 md:pt-20">
          <h1 className="type-hero text-balance">{t("hero.title")}</h1>
          <TypedSubtitle text={t("hero.subtitle")} className="type-hero-sub mt-4 max-w-[34rem] text-pretty" />
          <div className="mt-7 flex flex-wrap gap-2.5">
            {/* "Try the demo": a sample photo through the whole inspection, no account needed. */}
            <Link href={`/app/new?sample=${DEMO_SAMPLE}`} className={pill()}>
              {t("hero.primary")}
            </Link>
            <Link href="/#how-it-works" className={pill({ variant: "secondary" })}>
              {t("hero.secondary")}
            </Link>
          </div>
        </section>

        <div className="wide mt-12 md:mt-20">
          <div className="relative aspect-[1136/456] overflow-hidden rounded bg-ink">
            <Image
              src={heroPhoto}
              alt={t("hero.photoAlt")}
              fill
              // The largest element above the fold: fetch it first.
              fetchPriority="high"
              loading="eager"
              placeholder="blur"
              sizes="(min-width: 1168px) 1136px, 100vw"
              className="object-cover"
            />
          </div>
        </div>

        <section id="problem" className="col mt-20 md:mt-28" data-reveal>
          <SectionLabel>{t("problem.label")}</SectionLabel>
          <h2 className="type-heading mt-5 max-w-[26rem] text-balance">{t("problem.title")}</h2>
          <div className="type-body mt-5 flex flex-col gap-4">
            <p>{t("problem.p1")}</p>
            <p>{t("problem.p2")}</p>
            <p>{t("problem.p3")}</p>
          </div>
        </section>

        <div className="col mt-12" data-reveal>
          <Image
            src={dockPhoto}
            alt={t("problem.photoAlt")}
            placeholder="blur"
            sizes="(min-width: 760px) 688px, 100vw"
            className="aspect-[688/292] w-full rounded object-cover"
          />
        </div>

        <section id="how-it-works" className="col mt-12" data-reveal>
          <SectionLabel>{t("solution.label")}</SectionLabel>
          <h2 className="type-heading mt-5 max-w-[26rem] text-balance">{t("solution.title")}</h2>
          <div className="type-body mt-5 flex flex-col gap-4">
            <p>{t("solution.body")}</p>
            <p>{t("solution.listLabel")}</p>
          </div>
          <ul className="mt-10 grid grid-cols-2 gap-x-4 gap-y-8 md:gap-x-5 md:gap-y-9">
            {STEPS.map(({ id, icon: Icon }) => (
              <li key={id} className="flex flex-col gap-3 md:flex-row md:gap-6">
                <span className="flex size-11 shrink-0 items-center justify-center rounded bg-surface">
                  <Icon aria-hidden className="size-5" strokeWidth={1.5} />
                </span>
                <div>
                  <h3 className="font-medium text-ink">{t(`solution.items.${id}.title`)}</h3>
                  <p className="type-body mt-1 max-md:text-[0.875rem]">{t(`solution.items.${id}.body`)}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section id="scenarios" className="wide mt-24 md:mt-32" data-reveal>
          <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="type-heading">{t("scenarios.title")}</h2>
              <p className="type-body mt-2 max-w-[28rem]">{t("scenarios.lead")}</p>
            </div>
            <Link href="/app" className={pill({ variant: "secondary", className: "max-md:w-full" })}>
              {t("scenarios.cta")}
            </Link>
          </div>
          <Scenarios />
        </section>
      </main>
    </>
  );
}
