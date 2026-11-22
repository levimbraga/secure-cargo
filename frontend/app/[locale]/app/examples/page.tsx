import type { Metadata } from "next";
import { Fragment, use } from "react";
import { hasLocale, useTranslations } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { ExampleClip } from "@/components/app/example-clip";
import { ExampleLinks } from "@/components/app/example-links";
import { SiteNav } from "@/components/site/site-nav";
import { VerdictBadge } from "@/components/ui/verdict-badge";
import { routing } from "@/i18n/routing";
import { DEMO_IDS, VARIANTS } from "@/lib/demo";
import { demoSummary } from "@/lib/demo-summaries";
import { COVERAGE, coverageTotals, explorerQueries } from "@/lib/gallery";

export async function generateMetadata({ params }: PageProps<"/[locale]/app/examples">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Gallery" });
  return { title: t("metaTitle"), description: t("description") };
}

/** Explorer option names: the coverage matrix uses the same words as the explorer's selectors. */
const EXPLORER_DIMENSIONS = ["body", "size", "cargo", "position", "restraint", "road", "weather", "event"];

/**
 * The gallery: every example as loaded and fixed, each as a short clip of the realistic replay
 * (a link into the explorer) with its verdict, one-sentence story and a link to MuJoCo's raw
 * render as proof; then the ways into it and the coverage matrix of `docs/coverage.md`.
 */
export default function ExamplesPage({ params }: PageProps<"/[locale]/app/examples">) {
  const { locale } = use(params);
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = useTranslations("Gallery");
  const scenario = useTranslations("Scenario");
  const explorer = useTranslations("Explorer");
  const asLoaded = explorerQueries("as_loaded");
  const fixed = explorerQueries("fixed");
  const { covered, total } = coverageTotals(COVERAGE);

  const optionName = (dimension: string, option: string) => {
    if (EXPLORER_DIMENSIONS.includes(dimension)) return explorer(`options.${dimension}.${option}` as never);
    return t(`coverage.${dimension}.${option}` as never);
  };

  return (
    <>
      <SiteNav variant="minimal" />
      <main className="wide flex-1 pt-10 pb-24 md:pt-14">
        <header className="max-w-[43rem]">
          <p className="type-label">{t("label")}</p>
          <h1 className="type-hero mt-4 text-balance">{t("title")}</h1>
          <p className="type-body mt-3 text-pretty">{t("intro")}</p>
        </header>

        <ol className="mt-10 border-b border-hairline">
          {DEMO_IDS.map((id, index) => {
            const summary = demoSummary(id);
            const title = scenario(`titles.${id}`);
            return (
              <li key={id} id={id} className="border-t border-hairline py-8">
                <h2 className="type-card-title">
                  <span className="font-mono text-[0.8125rem] text-gray">{index + 1}. </span>
                  {title}
                </h2>
                <p className="mt-1 font-mono text-[0.8125rem] text-gray">
                  {scenario(`events.${id}`, { speed: summary.event.speed_kmh })}
                </p>
                {/* Side by side from tablets up, stacked on a phone. */}
                <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-7 sm:grid-cols-2">
                  {VARIANTS.map((variant) => {
                    const status = summary.runs[variant].verdict.status;
                    const name = t(variant === "as_loaded" ? "asLoaded" : "fixed");
                    const query = (variant === "as_loaded" ? asLoaded : fixed)[id] ?? "";
                    return (
                      <figure key={variant} className="min-w-0">
                        <ExampleClip
                          clip={`/demo/clips/${id}.${variant}`}
                          href={query}
                          label={t("clip.alt", { title, variant: name })}
                          linkLabel={t("clip.openName", { title, variant: name })}
                        />
                        <figcaption className="mt-2.5">
                          <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                            <VerdictBadge verdict={status === "pass" ? "pass" : "fail"}>
                              {name} · {scenario(`verdict.${status}`)}
                            </VerdictBadge>
                            <a
                              href={`/demo/video/${id}.${variant}.mp4`}
                              aria-label={t("clip.rawName", { title, variant: name })}
                              className="type-label inline-flex min-h-11 items-center underline decoration-hairline underline-offset-4 hover:text-ink sm:min-h-8"
                            >
                              {t("clip.raw")}
                            </a>
                          </span>
                          <span className="mt-1.5 block text-[0.9375rem] text-pretty text-ink">
                            {scenario(`sentences.${id}.${variant}`)}
                          </span>
                        </figcaption>
                      </figure>
                    );
                  })}
                </div>
                <div className="mt-3">
                  <ExampleLinks id={id} explorer={asLoaded[id] ?? ""} fixedExplorer={fixed[id]} />
                </div>
              </li>
            );
          })}
        </ol>

        <section aria-labelledby="coverage" className="mt-16 max-w-[43rem]">
          <h2 id="coverage" className="type-heading">
            {t("coverage.title")}
          </h2>
          <p className="type-body mt-2">{t("coverage.summary", { covered, total, examples: COVERAGE.examples.length })}</p>
          {COVERAGE.dimensions.map((dimension) => (
            <Fragment key={dimension.id}>
              <h3 className="type-label mt-8">{t(`coverage.dims.${dimension.id}` as never)}</h3>
              <table className="mt-2 w-full border-b border-hairline text-left text-sm">
                <thead className="sr-only">
                  <tr>
                    <th scope="col">{t("coverage.option")}</th>
                    <th scope="col">{t("coverage.examples")}</th>
                  </tr>
                </thead>
                <tbody>
                  {dimension.options.map((option) => {
                    const examples = [...new Set(option.covered_by.map((item) => item.example))];
                    const viaTrip = option.covered_by.every((item) => item.via);
                    return (
                      <tr key={option.id} className="border-t border-hairline align-baseline">
                        <th scope="row" className="w-2/5 py-2 pr-4 font-normal text-ink">
                          {optionName(dimension.id, option.id)}
                        </th>
                        <td className="py-2 font-mono text-[0.8125rem] text-gray">
                          {examples.length ? (
                            <>
                              {examples.map((example, position) => (
                                <Fragment key={example}>
                                  {position > 0 && ", "}
                                  <a href={`#${example}`} className="underline decoration-hairline underline-offset-4 hover:text-ink">
                                    {scenario(`titles.${example}`)}
                                  </a>
                                </Fragment>
                              ))}
                              {viaTrip && ` (${t("coverage.viaTrip")})`}
                            </>
                          ) : (
                            <span className="italic">{t("coverage.none")}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Fragment>
          ))}
        </section>
      </main>
    </>
  );
}
