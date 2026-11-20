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
    <div className="flex h-14 items-center justify-between gap-6 border-t border-hairline">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono tabular-nums">
        {value ?? <span aria-hidden className="block h-4 w-16 rounded-sm bg-surface" />}
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
        <h1 className="type-h2 mt-3 text-balance">{t(`states.${state.kind}.sentence`)}</h1>
        <VerdictBadge verdict={VERDICT[state.kind]} className="mt-5">
          {t(`states.${state.kind}.badge`)}
        </VerdictBadge>
      </div>

      {state.kind === "offline" ? (
        <div className="mt-8 flex flex-col items-start gap-5 border-t border-hairline pt-6">
          <p role="alert">{t(`errors.${state.code}`)}</p>
          <button type="button" onClick={retry} className={pill({ variant: "secondary" })}>
            {t("retry")}
          </button>
        </div>
      ) : (
        <dl className="mt-8 border-b border-hairline">
          <Row label={t("rows.status")} value={health?.status} />
          <Row label={t("rows.version")} value={health?.version} />
          <Row label={t("rows.mujocoVersion")} value={health?.mujocoVersion} />
        </dl>
      )}

      <p className="mt-4 font-mono text-sm break-all text-muted-foreground">{API_URL}/health</p>
    </section>
  );
}
