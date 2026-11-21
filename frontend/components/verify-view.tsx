"use client";

import { cn } from "cn";
import { useFormatter, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";

import { TruckArt } from "@/components/inspection/truck-art";
import { API_URL } from "@/lib/api";
import type { BodyStyle, TruckSize } from "@/lib/inspection/trucks";

type Verification = {
  id: string;
  issued_at: string;
  content_hash: string;
  authentic: boolean;
  revoked_at: string | null;
  valid: boolean;
  summary: {
    state: "approved" | "fixed_and_proven" | "holds_noncompliant";
    inspected_at: string;
    proven_at: string | null;
    organization: { name: string | null; type: string | null } | null;
    truck: { size: string | null; style: string | null; body?: string | null };
    situations: { passed: number | null; total: number | null };
    checks_failed: number;
  } | null;
};

const SIZES = ["vuc", "three_quarter", "toco", "truck", "semi"];
const STYLES = ["open_low_sides", "open_tall_rack", "platform", "box", "curtain_sider"];
const STYLE_OF_BODY: Record<string, BodyStyle> = { flatbed: "platform", box: "box", curtain_sider: "curtain_sider" };

/** The id from `/verify/<id>` (rewritten here by the proxy) or `/verify?id=`. */
export function VerifyFromUrl() {
  const query = useSearchParams().get("id");
  // The address bar keeps `/verify/<id>` (the rewrite is on the server): read it from there.
  const path = useSyncExternalStore(
    () => () => {},
    () => window.location.pathname,
    () => null,
  );
  const fromPath = path ? /\/verify\/([^/?#]+)/.exec(path)?.[1] : undefined;
  const id = query ?? (fromPath ? decodeURIComponent(fromPath) : path === null ? null : "");
  if (id === null) return null;
  return <VerifyView key={id} id={id} />;
}

function VerifyView({ id }: { id: string }) {
  const t = useTranslations("Verify");
  const cert = useTranslations("Certificate");
  const driver = useTranslations("Driver");
  const format = useFormatter();
  const [data, setData] = useState<Verification | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/verify/${encodeURIComponent(id)}`, { cache: "no-store" })
      .then(async (response) => {
        if (cancelled) return;
        if (!response.ok) setMissing(true);
        else setData((await response.json()) as Verification);
      })
      .catch(() => !cancelled && setMissing(true));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const date = (iso: string) => format.dateTime(new Date(iso), { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  if (missing) {
    return (
      <div data-testid="verify" data-valid="missing">
        <p className="type-label">{t("label")}</p>
        <h1 className="type-hero mt-5">{t("notFound")}</h1>
        <p className="type-body mt-4">{t("notFoundSentence")}</p>
        <p className="mt-6 font-mono text-[0.9375rem]">{id}</p>
      </div>
    );
  }
  if (!data) return <p className="type-small text-gray">{t("checking")}</p>;

  const s = data.summary;
  const tone = data.valid ? "pass" : data.authentic ? "warn" : "fail";
  const size = s?.truck.size && SIZES.includes(s.truck.size) ? (s.truck.size as TruckSize) : null;
  const style = s?.truck.style && STYLES.includes(s.truck.style) ? (s.truck.style as BodyStyle) : (STYLE_OF_BODY[s?.truck.body ?? ""] ?? null);
  return (
    <div data-testid="verify" data-valid={String(data.valid)}>
      <p className="type-label">{t("label")}</p>
      <div className="mt-5 flex items-start gap-3">
        <span
          aria-hidden
          className={cn(
            "mt-1 flex size-8 shrink-0 items-center justify-center rounded-full",
            tone === "pass" ? "bg-pass-tint text-pass" : tone === "warn" ? "bg-warn-tint text-warn" : "bg-fail-tint text-fail",
          )}
        >
          <svg width="16" height="16" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {tone === "pass" ? <path d="M2.5 7.5 5.5 10.5 11.5 3.5" /> : tone === "warn" ? <path d="M7 3v5M7 10.8v.2" /> : <path d="M3 3l8 8M11 3l-8 8" />}
          </svg>
        </span>
        <h1 className="type-hero">{data.valid ? t("valid") : data.authentic ? t("revoked") : t("invalid")}</h1>
      </div>
      <p className="type-body mt-4">{data.valid ? t("validSentence") : data.authentic ? t("revokedSentence") : t("invalidSentence")}</p>

      <dl className="mt-8 border-b border-hairline text-[0.9375rem]">
        <Row label={t("id")}>
          <span className="font-mono">{data.id}</span>
        </Row>
        <Row label={t("issued")}>{date(data.issued_at)}</Row>
        {s && (
          <>
            <Row label={t("result")}>
              <span className={s.state === "holds_noncompliant" ? "text-warn" : "text-pass"}>{cert(`states.${s.state}`)}</span>
            </Row>
            <Row label={t("inspected")}>{date(s.inspected_at)}</Row>
            <Row label={t("situations")}>
              {t("situationsLine", { passed: s.situations.passed ?? 0, total: s.situations.total ?? 0 })} · {t("checksFailed", { count: s.checks_failed })}
            </Row>
            {size && style && (
              <Row label={t("truck")}>
                <span className="flex items-center justify-between gap-3">
                  {driver("truck.name", { size: driver(`sizes.${size}.name`), body: driver(`styles.${style}.short`) })}
                  <TruckArt size={size} style={style} className="h-6 w-auto shrink-0 text-ink" />
                </span>
              </Row>
            )}
            {s.organization?.name && <Row label={t("issuer")}>{s.organization.name}</Row>}
          </>
        )}
      </dl>

      <h2 className="type-label mt-8">{t("hash")}</h2>
      <p className="mt-2 font-mono text-[0.8125rem] break-all" data-testid="verify-hash">
        {data.content_hash}
      </p>
      <p className="type-small mt-1 text-gray">{t("hashHint")}</p>

      <p className="type-small mt-10 text-gray">{t("minimal")}</p>
      <p className="type-small mt-3 text-gray">{t("disclaimerText")}</p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-4 border-t border-hairline py-3">
      <dt className="text-gray">{label}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}
