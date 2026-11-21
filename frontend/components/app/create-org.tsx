"use client";

import { useOrganizationList } from "@clerk/nextjs";
import { cn } from "cn";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { useMe } from "@/components/app/me-provider";
import { pill } from "@/components/ui/pill";
import { AppApiError, useAppApi } from "@/lib/app-api";

/**
 * A signed-in user without an organization creates one (insurer or carrier) and becomes its
 * manager; the session then switches to it. Demo accounts never see this: they are in the demo org.
 */
export function CreateOrg() {
  const t = useTranslations("Manager.create");
  const { me, refresh } = useMe();
  const request = useAppApi();
  const { setActive } = useOrganizationList();
  const [name, setName] = useState("");
  const [type, setType] = useState<"insurer" | "carrier">("carrier");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (me?.user.is_demo) return <p className="type-body col">{t("demo")}</p>;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const org = await request<{ id: string }>("/orgs", { method: "POST", body: JSON.stringify({ name, type }) });
      // The new organization becomes the active one in the session (a new token carries it).
      await setActive?.({ organization: org.id });
      refresh();
    } catch (cause) {
      setError(cause instanceof AppApiError && cause.code === "invalid_name" ? t("errors.invalid_name") : t("errors.failed"));
      setBusy(false);
    }
  }

  const field = "mt-1 h-11 w-full rounded-[4px] border border-control-border bg-white px-3 text-[0.9375rem]";
  return (
    <div className="col">
      <h1 className="type-hero text-balance">{t("title")}</h1>
      <p className="type-body mt-4">{t("sentence")}</p>
      <form onSubmit={submit} className="mt-8 grid max-w-[420px] gap-5">
        <label className="type-small text-gray">
          {t("name")}
          <input required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className={field} />
        </label>
        <fieldset>
          <legend className="type-small text-gray">{t("type")}</legend>
          <div className="mt-2 grid grid-cols-2 gap-3">
            {(["carrier", "insurer"] as const).map((value) => (
              <label
                key={value}
                className={cn(
                  "flex h-14 cursor-pointer items-center justify-center rounded-[6px] border text-[0.9375rem]",
                  type === value ? "border-ink bg-white text-ink" : "border-hairline text-gray",
                )}
              >
                <input type="radio" name="type" value={value} checked={type === value} onChange={() => setType(value)} className="sr-only" />
                {t(value)}
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <button type="submit" disabled={busy} className={pill({ className: "h-11 px-5" })}>
            {busy ? t("creating") : t("submit")}
          </button>
        </div>
        {error && (
          <p role="alert" className="type-small text-fail">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
