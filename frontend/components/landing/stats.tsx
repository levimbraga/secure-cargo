import { useTranslations } from "next-intl";

import { Num } from "@/components/ui/num";
import { STATS, statsAreSourced } from "@/content/stats";

/** Big mono figures with captions and sources. Hidden in production until every figure is sourced. */
export function Stats() {
  const t = useTranslations("Landing.stats");

  if (!statsAreSourced() && process.env.NODE_ENV === "production") return null;

  return (
    <section aria-label={t("label")} className="border-t border-hairline">
      <dl className="shell grid grid-cols-2 gap-x-8 gap-y-12 py-16 md:grid-cols-4 md:py-24" data-reveal>
        {STATS.map((stat) => (
          <div key={stat.id} className="flex flex-col-reverse gap-3">
            <dt className="type-small max-w-[18rem] text-muted-foreground">
              {t(`items.${stat.id}.caption`)}
              {stat.sourceUrl && (
                <>
                  {" "}
                  <a href={stat.sourceUrl} className="underline decoration-1 underline-offset-4">
                    {t("sourceLabel")}
                  </a>
                </>
              )}
            </dt>
            <dd className="type-stat">
              {stat.value === null ? (
                <span className="text-[0.4em] text-amber-ink">{t("placeholder")}</span>
              ) : (
                <Num value={stat.value} unit={stat.unit} />
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
