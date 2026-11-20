import { use } from "react";
import { hasLocale, useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { ApiWarmup } from "@/components/api-warmup";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

const STEPS = ["perceive", "simulate", "plan"] as const;

export default function LandingPage({ params }: PageProps<"/[locale]">) {
  const { locale } = use(params);
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = useTranslations("Landing");

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-16 px-5 py-14 sm:py-24">
      <ApiWarmup />
      <section className="flex flex-col items-start gap-6">
        <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <span aria-hidden className="size-2 rounded-full bg-brand" />
          {t("eyebrow")}
        </p>
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
          {t("title")}
        </h1>
        <p className="max-w-2xl text-lg text-pretty text-muted-foreground">
          {t("lead")}
        </p>
        <Link
          href="/app"
          className={buttonVariants({ size: "lg", className: "h-11 px-5 text-base" })}
        >
          {t("cta")}
        </Link>
      </section>

      <section aria-labelledby="how-it-works" className="flex flex-col gap-6">
        <h2
          id="how-it-works"
          className="text-sm font-medium tracking-wide text-muted-foreground uppercase"
        >
          {t("stepsTitle")}
        </h2>
        <ol className="grid gap-4 sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <li
              key={step}
              className="flex flex-col gap-2 rounded-xl bg-card p-5 ring-1 ring-foreground/10"
            >
              <span
                aria-hidden
                className="flex size-7 items-center justify-center rounded-full bg-brand font-mono text-sm font-semibold text-brand-foreground"
              >
                {index + 1}
              </span>
              <h3 className="text-base font-medium">
                {t(`steps.${step}.title`)}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t(`steps.${step}.body`)}
              </p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
