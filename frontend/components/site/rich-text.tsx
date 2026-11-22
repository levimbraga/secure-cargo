import { Fragment, type ReactNode } from "react";

import { Link } from "@/i18n/navigation";

/**
 * The small inline markup of the long-form pages (`messages/pages/*.json`): `[text](href)`,
 * `**bold**`, `*italic*` and `` `code` ``. A link that starts with `/` stays on the site in the
 * page's language; any other opens the external page. Nothing else is interpreted, and the text is
 * never rendered as HTML.
 */
const TOKEN = /\[([^\]]+)\]\(([^)\s]+(?:\([^)\s]*\))?[^)\s]*)\)|\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`/g;

export function RichText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    const at = match.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    const [, label, href, bold, italic, code] = match;
    const key = `${at}`;
    if (label && href) {
      parts.push(
        href.startsWith("/") ? (
          <Link key={key} href={href} className="text-ink underline decoration-hairline underline-offset-4 hover:decoration-ink">
            <RichText text={label} />
          </Link>
        ) : (
          <a key={key} href={href} rel="noopener noreferrer" className="text-ink underline decoration-hairline underline-offset-4 hover:decoration-ink">
            <RichText text={label} />
          </a>
        ),
      );
    } else if (bold) {
      parts.push(
        <strong key={key} className="font-medium text-ink">
          {bold}
        </strong>,
      );
    } else if (italic) {
      parts.push(<em key={key}>{italic}</em>);
    } else if (code) {
      parts.push(
        <code key={key} className="font-mono text-[0.875em] text-ink">
          {code}
        </code>,
      );
    }
    last = at + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <Fragment>{parts}</Fragment>;
}
