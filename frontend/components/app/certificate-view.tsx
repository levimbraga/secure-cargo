"use client";

import { cn } from "cn";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";

import { useMe } from "@/components/app/me-provider";
import { TruckArt } from "@/components/inspection/truck-art";
import { pill } from "@/components/ui/pill";
import { VerdictBadge } from "@/components/ui/verdict-badge";
import { Link, useRouter } from "@/i18n/navigation";
import { AppApiError, type Certificate, usePhotoSrc, useAppApi } from "@/lib/app-api";
import type { BodyStyle, TruckSize } from "@/lib/inspection/trucks";

/** Where the QR points: the public verify page on the production site. */
export const VERIFY_ORIGIN = "https://securecargo.app";

export function verifyUrl(id: string): string {
  return `${VERIFY_ORIGIN}/verify/${id}`;
}

export function CertificateFromQuery() {
  const id = useSearchParams().get("id") ?? "";
  return <CertificateView key={id} id={id} />;
}

const SIZES = ["vuc", "three_quarter", "toco", "truck", "semi"];
const STYLES = ["open_low_sides", "open_tall_rack", "platform", "box", "curtain_sider"];
const STYLE_OF_BODY: Record<string, BodyStyle> = { flatbed: "platform", box: "box", curtain_sider: "curtain_sider" };

/** The strings of a certificate, translated once for the page and the PDF. */
function useCertificateText(cert: Certificate | null) {
  const t = useTranslations("Certificate");
  const driver = useTranslations("Driver");
  const audit = useTranslations("Audit");
  const events = useTranslations("Explorer.options.event");
  const cargo = useTranslations("Explorer.options.cargo");
  const format = useFormatter();
  if (!cert) return null;
  const c = cert.content;
  const date = (iso: string) => format.dateTime(new Date(iso), { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const size = c.truck.size && SIZES.includes(c.truck.size) ? (c.truck.size as TruckSize) : null;
  const style = c.truck.style && STYLES.includes(c.truck.style) ? (c.truck.style as BodyStyle) : (STYLE_OF_BODY[c.truck.body ?? ""] ?? null);
  const truckName = size && style ? driver("truck.name", { size: driver(`sizes.${size}.name`), body: driver(`styles.${style}.short`) }) : "—";
  const cargoNames = c.cargo.types.map((k) => (cargo.has(k as never) ? cargo(k as never) : k)).join(", ");
  const source = c.cargo.weight_source && ["measured", "invoice", "estimated"].includes(c.cargo.weight_source) ? audit(`weightSource.${c.cargo.weight_source as "measured"}`) : "";
  const checkName = (code: string) => (t.has(`checkNames.${code}` as never) ? t(`checkNames.${code}` as never) : code);
  const status = (s: string) => (["pass", "fail", "to_confirm", "not_applicable"].includes(s) ? t(`check.${s as "pass"}`) : s);
  const rows: [string, string][] = [
    [t("issuedLabel"), date(cert.issued_at)],
    [t("inspectedLabel"), date(c.inspected_at)],
    ...(c.proven_at ? ([[t("provenLabel"), date(c.proven_at)]] as [string, string][]) : []),
    [t("organization"), c.organization?.name ?? "—"],
    [t("truck"), truckName],
    [
      t("cargo"),
      `${cargoNames ? `${cargoNames} · ` : ""}${t("cargoLine", { weight: format.number(c.cargo.weight_kg ?? 0), units: c.cargo.units, source })}`,
    ],
  ];
  return {
    size,
    style,
    rows,
    truckRow: t("truck"),
    title: t("title", { id: cert.id }),
    label: t("label"),
    stateLine: t(`states.${c.state}`),
    tone: c.state === "holds_noncompliant" ? ("warn" as const) : ("pass" as const),
    situationsTitle: `${t("results")} · ${t("resultsLine", { passed: c.results.passed, total: c.results.total })}`,
    situations: c.results.situations.map((s) => ({
      name: events.has(s.id as never) ? events(s.id as never) : s.id,
      status: t(`situation.${(["pass", "warning", "fail"].includes(s.status) ? s.status : "fail") as "pass"}`),
      ok: s.status !== "fail",
    })),
    checksTitle: t("checks"),
    checks: c.checks.map((k) => ({
      name: checkName(k.code),
      article: k.article ?? "",
      status: status(k.status),
      ok: k.status === "pass" ? true : k.status === "fail" ? false : null,
    })),
    axlesTitle: t("axles"),
    axles: c.axle_loads.map((a) =>
      t("axleLine", {
        group: driver.has(`problem.axleName.${a.group}` as never) ? driver(`problem.axleName.${a.group}` as never) : (a.group ?? "—"),
        load: format.number(a.load_kg / 1000, { maximumFractionDigits: 1 }),
        limit: format.number(a.limit_kg / 1000, { maximumFractionDigits: 1 }),
      }),
    ),
    hashLabel: t("hash"),
    scanLabel: t("scan"),
    warning: cert.revoked_at ? t("revoked") : !cert.authentic ? t("notAuthentic") : null,
  };
}

/**
 * `/app/certificate?id=SC-…`: the certificate of an inspection, for whoever may read it, with its
 * PDF. The record and its hash come from the server; the public check is at `/verify/<id>`.
 */
function CertificateView({ id }: { id: string }) {
  const t = useTranslations("Certificate");
  const locale = useLocale();
  const { ready, signedIn } = useMe();
  const request = useAppApi();
  const router = useRouter();
  const [cert, setCert] = useState<Certificate | null>(null);
  const [missing, setMissing] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const truckRef = useRef<HTMLDivElement>(null);
  const text = useCertificateText(cert);
  const photo = usePhotoSrc(cert?.photo?.inspection_id ?? "", cert?.photo?.photo_id ?? null, cert?.photo ? (cert.photo.path ? `sample:${cert.photo.path}` : "private") : null);

  useEffect(() => {
    if (ready && !signedIn) router.replace("/app/sign-in");
  }, [ready, signedIn, router]);

  useEffect(() => {
    if (!signedIn || !id) return;
    let cancelled = false;
    request<Certificate>(`/certificates/${encodeURIComponent(id)}`)
      .then((value) => !cancelled && setCert(value))
      .catch((error: unknown) => !cancelled && error instanceof AppApiError && setMissing(true));
    QRCode.toString(verifyUrl(id), { type: "svg", margin: 1, errorCorrectionLevel: "M" })
      .then((svg) => !cancelled && setQr(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [id, signedIn, request]);

  async function downloadPdf() {
    if (!cert || !text) return;
    setMaking(true);
    try {
      const { certificatePdf, svgToPng } = await import("@/lib/certificate-pdf");
      const svg = truckRef.current?.querySelector("svg");
      const truck = svg ? await svgToPng(svg).catch(() => null) : null;
      const photoBytes = photo ? await fetch(photo).then((r) => (r.ok ? r.arrayBuffer() : null)).then((b) => (b ? new Uint8Array(b) : null)).catch(() => null) : null;
      const bytes = await certificatePdf({
        ...text,
        id: cert.id,
        verifyUrl: verifyUrl(cert.id),
        hash: cert.content_hash,
        disclaimer: t("disclaimerText"),
        photo: photoBytes,
        truck,
      });
      const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = t("fileName", { id: cert.id });
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } finally {
      setMaking(false);
    }
  }

  if (missing || (ready && !signedIn)) return <p className="type-body col">{t("notFound")}</p>;
  if (!cert || !text) return <p className="type-small col text-gray">…</p>;
  const c = cert.content;
  const verify = `${locale === "pt-BR" ? `${VERIFY_ORIGIN}/pt-BR` : VERIFY_ORIGIN}/verify/${cert.id}`;

  return (
    <article className="col" data-testid="certificate">
      <Link href={`/app/inspection?id=${c.inspection_id}`} className="type-small text-gray hover:text-ink">
        ← {t("back")}
      </Link>
      <p className="type-label mt-8">{text.label}</p>
      <h1 className="type-hero mt-5 font-mono">{cert.id}</h1>
      <div className="mt-4">
        <VerdictBadge verdict={text.tone}>{text.stateLine}</VerdictBadge>
      </div>
      {text.warning && <p className="type-body mt-4 text-fail">{text.warning}</p>}

      <div className="mt-8 grid gap-6 sm:grid-cols-[1fr_auto] sm:items-start">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- the inspection's own photo (private or sample)
          <img src={photo} alt={t("photo")} className="aspect-[4/3] w-full rounded object-cover" />
        ) : (
          <div className="aspect-[4/3] w-full rounded bg-surface" aria-hidden />
        )}
        <div className="flex flex-col items-start gap-2 sm:w-[160px]">
          {qr && (
            // eslint-disable-next-line @next/next/no-img-element -- a QR code made on the page
            <img src={qr} alt={t("scan")} width={160} height={160} className="size-[160px] rounded bg-white p-1" data-testid="certificate-qr" />
          )}
          <span className="type-small text-gray">{t("scan")}</span>
          <a href={verify} className="type-small break-all text-ink underline decoration-1 underline-offset-4">
            {verify.replace("https://", "")}
          </a>
        </div>
      </div>

      <dl className="mt-8 border-b border-hairline">
        {text.rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[140px_1fr] gap-4 border-t border-hairline py-3 text-[0.9375rem]">
            <dt className="text-gray">{label}</dt>
            <dd className="flex items-center justify-between gap-3 text-ink">
              {value}
              {label === text.truckRow && text.size && text.style && (
                <span ref={truckRef}>
                  <TruckArt size={text.size} style={text.style} className="h-6 w-auto shrink-0 text-ink" />
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-10 grid gap-10 md:grid-cols-2">
        <section>
          <h2 className="type-label">{text.situationsTitle}</h2>
          <ul className="mt-3">
            {text.situations.map((s) => (
              <li key={s.name} className="flex justify-between gap-3 border-t border-hairline py-2 text-[0.9375rem]">
                <span>{s.name}</span>
                <span className={s.ok ? "text-pass" : "text-fail"}>{s.status}</span>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h2 className="type-label">{text.checksTitle}</h2>
          <ul className="mt-3">
            {text.checks.map((k) => (
              <li key={k.name} className="flex justify-between gap-3 border-t border-hairline py-2 text-[0.9375rem]">
                <span>
                  {k.name}
                  {k.article && <span className="type-small ml-1.5 text-gray">{k.article}</span>}
                </span>
                <span className={cn("shrink-0", k.ok === null ? "text-gray" : k.ok ? "text-pass" : "text-fail")}>{k.status}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {text.axles.length > 0 && (
        <section className="mt-10">
          <h2 className="type-label">{text.axlesTitle}</h2>
          <p className="mt-3 text-[0.9375rem]">{text.axles.join(" · ")}</p>
        </section>
      )}

      <section className="mt-10">
        <h2 className="type-label">{text.hashLabel}</h2>
        <p className="mt-3 font-mono text-[0.8125rem] break-all" data-testid="certificate-hash">
          {cert.content_hash}
        </p>
      </section>

      <div className="mt-10">
        <button type="button" onClick={downloadPdf} disabled={making} className={pill({ className: "h-11 px-5" })} data-testid="certificate-pdf">
          {making ? t("pdfMaking") : t("pdf")}
        </button>
      </div>

      <p className="type-small mt-10 text-gray">{t("disclaimerText")}</p>
    </article>
  );
}
