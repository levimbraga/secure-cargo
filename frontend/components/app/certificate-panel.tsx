"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { pill } from "@/components/ui/pill";
import { Link, useRouter } from "@/i18n/navigation";
import { AppApiError, type Certificate, type CertificateStatus, useAppApi } from "@/lib/app-api";

/**
 * The certificate of an inspection: open it when issued, issue it when the inspection is eligible
 * (approved, or fixed and proven), or say why not. The server decides; this only asks.
 */
export function CertificatePanel({ inspectionId }: { inspectionId: string }) {
  const t = useTranslations("Certificate");
  const request = useAppApi();
  const router = useRouter();
  const [status, setStatus] = useState<CertificateStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    request<CertificateStatus>(`/inspections/${encodeURIComponent(inspectionId)}/certificate`)
      .then((value) => !cancelled && setStatus(value))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [inspectionId, request]);

  async function issue() {
    setBusy(true);
    setError(null);
    try {
      const cert = await request<Certificate>(`/inspections/${encodeURIComponent(inspectionId)}/certificate`, { method: "POST" });
      router.push(`/app/certificate?id=${cert.id}`);
    } catch (cause) {
      const code = cause instanceof AppApiError ? cause.code.replace(/^certificate_/, "") : "";
      setError(["not_simulated", "fails_no_proven_fix", "out_of_compliance"].includes(code) ? t(`notYet.${code as "not_simulated"}`) : t("notFound"));
      setBusy(false);
    }
  }

  if (!status) return null;
  return (
    <div className="mt-6 flex flex-wrap items-center gap-3" data-testid="certificate-panel">
      {status.certificate_id ? (
        <Link href={`/app/certificate?id=${status.certificate_id}`} className={pill({ className: "h-11 px-5" })}>
          {t("open")} · <span className="ml-1 font-mono">{status.certificate_id}</span>
        </Link>
      ) : status.eligibility.ok ? (
        <button type="button" onClick={issue} disabled={busy} className={pill({ className: "h-11 px-5" })}>
          {busy ? t("issuing") : t("get")}
        </button>
      ) : (
        <p className="type-small text-gray">{t(`notYet.${status.eligibility.code}`)}</p>
      )}
      {error && <p className="type-small text-fail">{error}</p>}
    </div>
  );
}
