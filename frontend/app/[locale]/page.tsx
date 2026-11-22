import { use } from "react";
import { Bell, Camera, FileCheck, LayoutDashboard, QrCode, ShieldCheck } from "lucide-react";
import Image from "next/image";
import { hasLocale, useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { ApiWarmup } from "@/components/api-warmup";
import { RevealOnScroll } from "@/components/landing/reveal-on-scroll";
import { ResultPreview } from "@/components/landing/result-preview";
import { Scenarios } from "@/components/landing/scenarios";
import { TypedSubtitle } from "@/components/landing/typed-subtitle";
import { SiteNav } from "@/components/site/site-nav";
import { TryDemo } from "@/components/site/try-demo";
import { pill } from "@/components/ui/pill";
import { SectionLabel } from "@/components/ui/section-label";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import dashboardPhoneEn from "@/public/media/dashboard-phone-en.jpg";
import dashboardPhonePt from "@/public/media/dashboard-phone-pt-BR.jpg";
import dashboardWideEn from "@/public/media/dashboard-wide-en.jpg";
import dashboardWidePt from "@/public/media/dashboard-wide-pt-BR.jpg";
import heroPhoto from "@/public/media/hero.jpg";
import simulationStill from "@/public/media/simulation-braking.jpg";

/** How it works, in the order the driver lives it. */
const STEPS = [
  { id: "photo", icon: Camera },
  { id: "result", icon: ShieldCheck },
  { id: "fix", icon: FileCheck },
] as const;

const FOR_COMPANIES = [
  { id: "dashboard", icon: LayoutDashboard },
  { id: "alerts", icon: Bell },
  { id: "certificate", icon: QrCode },
] as const;

/**
 * The landing page tells the product story in order: try it, how it works, what the result looks
 * like, the simulation behind it, what insurers and carriers get, and the scenarios gallery.
 * The stats row stays out until the numbers have sources.
 */
export default function LandingPage({ params }: PageProps<"/[locale]">) {
  const { locale } = use(params);
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = useTranslations("Landing");
  // The dashboard screenshots are in the page's language: the wide crop on desktop, the tiles on phones.
  const dashboard = locale === "pt-BR" ? { wide: dashboardWidePt, phone: dashboardPhonePt } : { wide: dashboardWideEn, phone: dashboardPhoneEn };

  return (
    <>
      <SiteNav variant="full" />
      <ApiWarmup />
      <RevealOnScroll />

      <main className="flex-1">
        {/* 1. Hero: "Try the demo" starts the demo driver session on the photo step, no account. */}
        <section className="col pt-14 md:pt-20">
          <h1 className="type-hero text-balance">{t("hero.title")}</h1>
          <TypedSubtitle text={t("hero.subtitle")} className="type-hero-sub mt-4 max-w-[34rem] text-pretty" />
          <div className="mt-7 flex flex-wrap gap-2.5">
            <TryDemo label={t("hero.primary")} />
            <Link href="/#how-it-works" className={pill({ variant: "secondary" })}>
              {t("hero.secondary")}
            </Link>
          </div>
          <p className="type-small mt-3 text-gray">{t("hero.note")}</p>
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

        {/* 2. How it works: photo → result → fix and proof. */}
        <section id="how-it-works" className="col mt-20 scroll-mt-20 md:mt-28" data-reveal>
          <SectionLabel>{t("steps.label")}</SectionLabel>
          <h2 className="type-heading mt-5 max-w-[30rem] text-balance">{t("steps.title")}</h2>
          <ol className="mt-10 grid gap-8 md:grid-cols-3 md:gap-6">
            {STEPS.map(({ id, icon: Icon }, index) => (
              <li key={id} className="flex gap-4 md:flex-col md:gap-3">
                <span className="flex size-11 shrink-0 items-center justify-center rounded bg-surface">
                  <Icon aria-hidden className="size-5" strokeWidth={1.5} />
                </span>
                <div>
                  <h3 className="font-medium text-ink">
                    <span className="type-label mr-2 text-gray">{index + 1}</span>
                    {t(`steps.items.${id}.title`)}
                  </h3>
                  <p className="type-body mt-1 text-[0.9375rem]">{t(`steps.items.${id}.body`)}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* 3. The result: three states, the same everywhere. */}
        <section id="result" className="col mt-24 scroll-mt-20 md:mt-28" data-reveal>
          <SectionLabel>{t("result.label")}</SectionLabel>
          <h2 className="type-heading mt-5 max-w-[30rem] text-balance">{t("result.title")}</h2>
          <p className="type-body mt-5">{t("result.body")}</p>
          <ResultPreview />
        </section>

        {/* 4. The simulation behind the verdict. */}
        <section className="col mt-24 md:mt-28" data-reveal>
          <SectionLabel>{t("simulation.label")}</SectionLabel>
          <h2 className="type-heading mt-5 max-w-[30rem] text-balance">{t("simulation.title")}</h2>
          <p className="type-body mt-5">{t("simulation.body")}</p>
          <figure className="mt-10">
            <Image
              src={simulationStill}
              alt={t("simulation.alt")}
              placeholder="blur"
              sizes="(min-width: 760px) 688px, 100vw"
              className="aspect-[1376/860] w-full rounded bg-surface object-cover"
            />
            <figcaption className="type-small mt-3 text-gray">
              {t("simulation.caption")}{" "}
              <Link href="/app/scenarios/emergency-braking" className="text-ink underline underline-offset-4">
                {t("simulation.link")}
              </Link>
            </figcaption>
          </figure>
        </section>

        {/* 5. For insurers and carriers. */}
        <section id="insurers" className="col mt-24 scroll-mt-20 md:mt-32" data-reveal>
          <SectionLabel>{t("companies.label")}</SectionLabel>
          <h2 className="type-heading mt-5 max-w-[30rem] text-balance">{t("companies.title")}</h2>
          <p className="type-body mt-5">{t("companies.body")}</p>
          <ul className="mt-10 grid gap-8 md:grid-cols-3 md:gap-6">
            {FOR_COMPANIES.map(({ id, icon: Icon }) => (
              <li key={id} className="flex gap-4 md:flex-col md:gap-3">
                <span className="flex size-11 shrink-0 items-center justify-center rounded bg-surface">
                  <Icon aria-hidden className="size-5" strokeWidth={1.5} />
                </span>
                <div>
                  <h3 className="font-medium text-ink">{t(`companies.items.${id}.title`)}</h3>
                  <p className="type-body mt-1 text-[0.9375rem]">{t(`companies.items.${id}.body`)}</p>
                </div>
              </li>
            ))}
          </ul>
          <figure className="mt-10">
            <Image
              src={dashboard.wide}
              alt={t("companies.alt")}
              placeholder="blur"
              sizes="688px"
              className="hidden h-auto w-full rounded md:block"
            />
            <Image
              src={dashboard.phone}
              alt={t("companies.alt")}
              placeholder="blur"
              sizes="100vw"
              className="h-auto w-full rounded md:hidden"
            />
            <figcaption className="type-small mt-3 text-gray">{t("companies.caption")}</figcaption>
          </figure>
          <div className="mt-8">
            <TryDemo role="insurer" variant="secondary" label={t("companies.cta")} />
          </div>
        </section>

        {/* 6. The scenarios gallery. */}
        <section id="scenarios" className="wide mt-24 scroll-mt-20 md:mt-32" data-reveal>
          <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="type-heading">{t("scenarios.title")}</h2>
              <p className="type-body mt-2 max-w-[28rem]">{t("scenarios.lead")}</p>
            </div>
            <Link href="/app/examples" className={pill({ variant: "secondary", className: "max-md:w-full" })}>
              {t("scenarios.cta")}
            </Link>
          </div>
          <Scenarios />
        </section>
      </main>
    </>
  );
}
