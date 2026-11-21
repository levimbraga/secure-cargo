"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { InspectionListItem } from "@/components/app/inspection-bits";
import { useMe } from "@/components/app/me-provider";
import { SignInPanel } from "@/components/app/sign-in-panel";
import { pill } from "@/components/ui/pill";
import { Link } from "@/i18n/navigation";
import { type InspectionSummary, useAppApi } from "@/lib/app-api";

/** `/app`: the driver's home. Signed out, it is the sign-in screen with the demo buttons. */
export function MemberHome() {
  const t = useTranslations("Member");
  const nav = useTranslations("AppNav");
  const { ready, signedIn, me } = useMe();
  const request = useAppApi();
  const [inspections, setInspections] = useState<InspectionSummary[] | null>(null);

  useEffect(() => {
    if (!me) return;
    let cancelled = false;
    request<{ inspections: InspectionSummary[] }>("/inspections?scope=mine")
      .then((body) => !cancelled && setInspections(body.inspections))
      .catch(() => !cancelled && setInspections([]));
    return () => {
      cancelled = true;
    };
  }, [me, request]);

  if (!ready) return <p className="type-small text-gray">{t("loading")}</p>;
  if (!signedIn) return <SignInPanel />;

  const allowance = me?.analysis;
  return (
    <>
      <section>
        <p className="type-label">{t("label")}</p>
        <h1 className="type-hero mt-5 text-balance">
          {inspections && inspections.length === 0 ? t("greetingEmpty") : t("greeting")}
        </h1>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/app/inspections/new" className={pill({ className: "h-11 px-4" })}>
            {t("newInspection")}
          </Link>
          <Link href="/app/explorer" className={pill({ variant: "secondary", className: "h-11 px-4" })}>
            {nav("explorer")}
          </Link>
        </div>
        {allowance && (
          <p className="type-small mt-4 text-gray">
            {allowance.mode === "demo"
              ? t("demoMode")
              : t(allowance.sharedPool ? "allowanceShared" : "allowance", {
                  used: allowance.usedToday,
                  quota: allowance.dailyQuota,
                })}
          </p>
        )}
      </section>

      <section className="mt-14">
        <h2 className="type-label">{t("listLabel")}</h2>
        {inspections === null ? (
          <p className="type-small mt-3 text-gray">{t("loading")}</p>
        ) : (
          <ul className="mt-3 border-b border-hairline">
            {inspections.map((inspection) => (
              <InspectionListItem key={inspection.id} inspection={inspection} />
            ))}
          </ul>
        )}
        <p className="type-small mt-4 text-gray">{t("explorerHint")}</p>
      </section>
    </>
  );
}
