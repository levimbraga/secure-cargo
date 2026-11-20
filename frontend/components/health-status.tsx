"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  API_URL,
  ApiError,
  type ApiErrorCode,
  fetchHealth,
  type Health,
} from "@/lib/api";

type State =
  | { kind: "loading" }
  | { kind: "online"; health: Health }
  | { kind: "offline"; code: ApiErrorCode };

export function HealthStatus() {
  const t = useTranslations("App.health");
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3">
          {t("title")}
          <span aria-live="polite">
            {state.kind === "loading" && (
              <Badge variant="secondary">{t("loading")}</Badge>
            )}
            {state.kind === "online" && (
              <Badge className="bg-emerald-600 text-white">{t("online")}</Badge>
            )}
            {state.kind === "offline" && (
              <Badge variant="destructive">{t("offline")}</Badge>
            )}
          </span>
        </CardTitle>
        <CardDescription className="font-mono text-xs break-all">
          {t("endpoint")}: {API_URL}/health
        </CardDescription>
      </CardHeader>

      <CardContent>
        {state.kind === "loading" && (
          <div aria-hidden className="flex flex-col gap-3">
            <div className="h-5 animate-pulse rounded bg-muted" />
            <div className="h-5 animate-pulse rounded bg-muted" />
            <div className="h-5 animate-pulse rounded bg-muted" />
          </div>
        )}

        {state.kind === "online" && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
            <dt className="text-muted-foreground">{t("status")}</dt>
            <dd className="text-right font-mono">{state.health.status}</dd>
            <dt className="text-muted-foreground">{t("version")}</dt>
            <dd className="text-right font-mono">{state.health.version}</dd>
            <dt className="text-muted-foreground">{t("mujocoVersion")}</dt>
            <dd className="text-right font-mono">
              {state.health.mujocoVersion}
            </dd>
          </dl>
        )}

        {state.kind === "offline" && (
          <div className="flex flex-col items-start gap-4">
            <p role="alert" className="text-sm">
              {t(`errors.${state.code}`)}
            </p>
            <Button variant="outline" size="lg" onClick={retry}>
              {t("retry")}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
