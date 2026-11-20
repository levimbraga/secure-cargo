import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import type { DemoId } from "@/lib/demo";
import { demoSummary } from "@/lib/demo-summaries";

/** The three ways into an example: its replay, the live lab, the explorer. Each is 44 px tall on phones. */
export function ExampleLinks({ id, explorer, fixedExplorer }: { id: DemoId; explorer: string; fixedExplorer?: string }) {
  const t = useTranslations("Gallery");
  const scenario = useTranslations("Scenario");
  const title = scenario(`titles.${id}`);
  const link =
    "type-label inline-flex min-h-11 items-center underline decoration-hairline underline-offset-4 hover:text-ink sm:min-h-8";
  return (
    <span className="flex flex-wrap gap-x-4">
      <Link href={`/app/scenarios/${id}`} aria-label={t("replayName", { title })} className={link}>
        {t("replay")}
      </Link>
      <Link href={`/app/lab/${id}`} aria-label={t("labName", { title })} className={link}>
        {t("lab")}
      </Link>
      <Link href={`/app/explorer?${explorer}`} aria-label={t("explorerName", { title })} className={link}>
        {t("explorer")}
      </Link>
      {fixedExplorer && (
        <Link href={`/app/explorer?${fixedExplorer}`} aria-label={t("explorerFixedName", { title })} className={link}>
          {t("explorerFixed")}
        </Link>
      )}
    </span>
  );
}

/**
 * The examples as rows: title and trip on the left (two lines on a phone), the ways into the
 * example under them on a phone and beside them on wider screens.
 */
export function ExampleRows({ ids, explorer }: { ids: readonly DemoId[]; explorer: Record<string, string> }) {
  const scenario = useTranslations("Scenario");
  return (
    <ul className="border-b border-hairline">
      {ids.map((id) => (
        <li
          key={id}
          className="grid grid-cols-1 gap-y-0.5 border-t border-hairline py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-x-6"
        >
          <span className="min-w-0">
            <span className="block text-[0.9375rem] text-ink">{scenario(`titles.${id}`)}</span>
            <span className="block font-mono text-[0.8125rem] text-gray">
              {scenario(`events.${id}`, { speed: demoSummary(id).event.speed_kmh })}
            </span>
          </span>
          <ExampleLinks id={id} explorer={explorer[id] ?? ""} />
        </li>
      ))}
    </ul>
  );
}
