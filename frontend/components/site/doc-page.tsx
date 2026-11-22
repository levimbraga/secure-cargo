import { getFormatter, getTranslations } from "next-intl/server";

import { RichText } from "@/components/site/rich-text";
import { SectionLabel } from "@/components/ui/section-label";
import type { Block, PageContent } from "@/lib/page-content";

function BlockView({ block }: { block: Block }) {
  if (typeof block === "string") {
    return (
      <p className="type-body text-pretty">
        <RichText text={block} />
      </p>
    );
  }
  if ("list" in block) {
    return (
      <ul className="type-body flex list-disc flex-col gap-2 pl-5 marker:text-control-border">
        {block.list.map((item) => (
          <li key={item} className="text-pretty">
            <RichText text={item} />
          </li>
        ))}
      </ul>
    );
  }
  // On a phone each row becomes a short block (its first cell, then "column: value" lines); from
  // the tablet width up it is a table. The page never scrolls sideways.
  const [first, ...rest] = block.table.head;
  return (
    <>
      <dl className="flex flex-col md:hidden">
        {block.table.rows.map((row) => (
          <div key={row.join("|")} className="border-b border-hairline py-3 first:border-t">
            <dt className="type-small text-ink">
              <span className="sr-only">{first}: </span>
              <RichText text={row[0] ?? ""} />
            </dt>
            {rest.map((head, n) =>
              row[n + 1] ? (
                <dd key={head} className="type-small mt-1 text-gray">
                  <span className="type-label mr-1.5">{head}</span>
                  <RichText text={row[n + 1] as string} />
                </dd>
              ) : null,
            )}
          </div>
        ))}
      </dl>
      <table className="type-small hidden w-full border-collapse text-left md:table">
        <thead>
          <tr>
            {block.table.head.map((cell) => (
              <th key={cell} scope="col" className="type-label border-b border-hairline py-2 pr-4 align-bottom font-normal">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.table.rows.map((row) => (
            <tr key={row.join("|")}>
              {row.map((cell, n) => (
                <td key={n} className={n === 0 ? "border-b border-hairline py-2.5 pr-4 align-top text-ink" : "border-b border-hairline py-2.5 pr-4 align-top text-gray"}>
                  <RichText text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/**
 * A long-form page: label, title, the date, an optional notice, the intro, a short table of
 * contents and the sections. Used by the legal pages, the methodology and the rule sources.
 */
export async function DocPage({ content, updated, legal }: { content: PageContent; updated: string; legal?: boolean }) {
  const t = await getTranslations("Legal");
  const format = await getFormatter();
  const date = format.dateTime(new Date(`${updated}T12:00:00-03:00`), { dateStyle: "long" });

  return (
    <main className="col flex-1 pt-10 pb-8 md:pt-16">
      <SectionLabel>{content.label}</SectionLabel>
      <h1 className="type-hero mt-5 text-balance">{content.title}</h1>
      <p className="type-label mt-4">{t("updated", { date })}</p>
      {legal && (
        <p role="note" className="type-small mt-6 rounded bg-surface px-4 py-3 text-ink">
          {t("notReviewed")}
        </p>
      )}
      <div className="mt-8 flex flex-col gap-5">
        {content.intro.map((paragraph) => (
          <p key={paragraph} className="type-body text-pretty">
            <RichText text={paragraph} />
          </p>
        ))}
      </div>

      <nav aria-label={t("onThisPage")} className="mt-10">
        <p className="type-label">{t("onThisPage")}</p>
        <ol className="type-small mt-3 flex flex-col gap-1.5">
          {content.sections.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`} className="text-gray hover:text-ink">
                {section.heading}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      {content.sections.map((section) => (
        <section key={section.id} id={section.id} className="mt-14 scroll-mt-24">
          <h2 className="type-card-title">{section.heading}</h2>
          <div className="mt-4 flex flex-col gap-4">
            {section.body.map((block, n) => (
              <BlockView key={n} block={block} />
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
