"use client";

/** "Share": a link to the public summary page, copied or sent on WhatsApp. */

import { useTranslations } from "next-intl";
import { useState } from "react";

import { pill } from "@/components/ui/pill";

export function whatsappHref(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export function ShareButton({ getUrl, verdict }: { getUrl: () => Promise<string | null>; verdict: string }) {
  const t = useTranslations("Driver.share");
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!url) {
    return (
      <>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const next = await getUrl().catch(() => null);
            setBusy(false);
            if (next) setUrl(next);
            else setFailed(true);
          }}
          className={pill({ variant: "secondary", className: "h-12 px-5" })}
          data-testid="share"
        >
          {busy ? t("creating") : t("button")}
        </button>
        {failed && <p className="type-small w-full text-gray">{t("signIn")}</p>}
      </>
    );
  }
  const message = t("message", { verdict, url });
  return (
    <div className="w-full rounded-md border border-hairline p-3" data-testid="share-panel">
      <p className="type-small break-all text-ink" data-testid="share-url">
        {url}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <a href={whatsappHref(message)} target="_blank" rel="noopener noreferrer" className={pill({ className: "h-11 px-4" })} data-testid="share-whatsapp">
          {t("whatsapp")}
        </a>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
          className={pill({ variant: "secondary", className: "h-11 px-4" })}
        >
          {copied ? t("copied") : t("copy")}
        </button>
      </div>
      <p className="type-small mt-2 text-gray">{t("hint")}</p>
    </div>
  );
}
