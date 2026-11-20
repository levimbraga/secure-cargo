"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { pill } from "@/components/ui/pill";
import { SectionLabel } from "@/components/ui/section-label";
import { VerdictBadge } from "@/components/ui/verdict-badge";
import { API_URL, ApiError, type ApiErrorCode, fetchHealth, type Health } from "@/lib/api";

type State =
  | { kind: "loading" }
  | { kind: "online"; health: Health }
  | { kind: "offline"; code: ApiErrorCode };

const VERDICT = { loading: "neutral", online: "pass", offline: "fail" } as const;

function Row({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-6 border-t border-hairline py-2.5">
      <dt className="text-gray">{label}</dt>
      <dd className="text-right font-mono text-[0.9375rem] break-all text-ink">
        {value ?? <span aria-hidden className="block h-3.5 w-14 rounded-sm bg-surface" />}
      </dd>
    </div>
  );
}

/** Answers "is the simulation server up?" in one sentence, then shows the details. */
export function HealthStatus() {
  const t = useTranslations("App");
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    fetchHealth(controller.signal).then(
      (health) => setState({ kind: "online", health }),
      (error: unknown) => {
        if (controller.signal.aborted) return;
        const code = error instanceof ApiError ? error.code : "unreachable";
        setState({ kind: "offline", code });
      },
    );

    return () => controller.abort();
  }, [attempt]);

  function retry() {
    setState({ kind: "loading" });
    setAttempt((current) => current + 1);
  }

  const health = state.kind === "online" ? state.health : undefined;

  return (
    <section>
      <SectionLabel>{t("label")}</SectionLabel>
      <div aria-live="polite">
        <h1 className="type-hero mt-5 text-balance">{t(`states.${state.kind}.sentence`)}</h1>
        <VerdictBadge verdict={VERDICT[state.kind]} className="mt-4">
          {t(`states.${state.kind}.badge`)}
        </VerdictBadge>
      </div>

      {state.kind === "offline" && (
        <div className="mt-7 flex flex-col items-start gap-4">
          <p role="alert" className="type-body">
            {t(`errors.${state.code}`)}
          </p>
          <button type="button" onClick={retry} className={pill({ variant: "secondary" })}>
            {t("retry")}
          </button>
        </div>
      )}

      <dl className="mt-9 border-b border-hairline">
        {state.kind !== "offline" && (
          <>
            <Row label={t("rows.status")} value={health?.status} />
            <Row label={t("rows.version")} value={health?.version} />
            <Row label={t("rows.mujocoVersion")} value={health?.mujocoVersion} />
          </>
        )}
        <Row label={t("rows.endpoint")} value={`${API_URL.replace(/^https?:\/\//, "")}/health`} />
      </dl>
    </section>
  );
}
