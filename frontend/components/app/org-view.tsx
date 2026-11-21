"use client";

import { cn } from "cn";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { InspectionVerdict, useDates, useTruckLabel } from "@/components/app/inspection-bits";
import { useMe } from "@/components/app/me-provider";
import { pill } from "@/components/ui/pill";
import { Link, useRouter } from "@/i18n/navigation";
import { AppApiError, type InspectionSummary, type OrgRole, type OrgView as OrgData, useAppApi } from "@/lib/app-api";

type Filter = "all" | "fail" | "fixed" | "pass";

const th = "type-label h-10 border-b border-hairline px-3 text-left font-normal first:pl-0";
const td = "border-b border-hairline px-3 py-3 align-middle first:pl-0";

/** `/app/org`: the manager's view (desktop-first). Every inspection of the organization, members, invite. */
export function OrgView() {
  const t = useTranslations("Org");
  const { ready, signedIn, me } = useMe();
  const request = useAppApi();
  const router = useRouter();
  const dates = useDates();
  const truck = useTruckLabel();
  const [org, setOrg] = useState<OrgData | null>(null);
  const [inspections, setInspections] = useState<InspectionSummary[] | null>(null);
  const [denied, setDenied] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [driver, setDriver] = useState<string>("");

  useEffect(() => {
    if (!me) return;
    let cancelled = false;
    Promise.all([
      request<OrgData>("/org"),
      request<{ inspections: InspectionSummary[] }>("/inspections?scope=org"),
    ])
      .then(([orgData, list]) => {
        if (cancelled) return;
        setOrg(orgData);
        setInspections(list.inspections);
      })
      .catch((error: unknown) => {
        if (!cancelled && error instanceof AppApiError) setDenied(true);
      });
    return () => {
      cancelled = true;
    };
  }, [me, request]);

  const shown = useMemo(
    () =>
      (inspections ?? []).filter((i) => {
        if (driver && i.author_id !== driver) return false;
        if (filter === "fail") return i.verdict === "fail";
        if (filter === "fixed") return i.fixed_verdict === "pass";
        if (filter === "pass") return i.verdict === "pass";
        return true;
      }),
    [inspections, filter, driver],
  );

  useEffect(() => {
    if (ready && !signedIn) router.replace("/app/sign-in");
  }, [ready, signedIn, router]);

  if (ready && !signedIn) return null;
  if (denied || (me && !me.org)) return <p className="type-body col">{t("noOrg")}</p>;
  if (!org || !inspections) return <p className="type-small col text-gray">{t("loading")}</p>;

  const failing = inspections.filter((i) => i.verdict === "fail").length;
  const fixed = inspections.filter((i) => i.fixed_verdict === "pass").length;
  const drivers = org.members.filter((m) => inspections.some((i) => i.author_id === m.userId));

  return (
    <div className="wide md:px-8">
      <p className="type-label">
        {t("label")} · {org.org.type === "insurer" ? t("typeInsurer") : t("typeCarrier")}
      </p>
      <h1 className="type-hero mt-5 text-balance">{t("title", { org: org.org.name })}</h1>
      <p className="type-body mt-4">{t("summary", { total: inspections.length, failing, fixed })}</p>

      <section className="mt-12">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="type-label">{t("inspectionsLabel")}</h2>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("filterLabel")}>
            {(["all", "fail", "fixed", "pass"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
                className={pill({ variant: filter === value ? "primary" : "secondary" })}
              >
                {t(value === "all" ? "filterAll" : value === "fail" ? "filterFail" : value === "fixed" ? "filterFixed" : "filterPass")}
              </button>
            ))}
            <label className="sr-only" htmlFor="driver-filter">
              {t("driverFilter")}
            </label>
            <select
              id="driver-filter"
              value={driver}
              onChange={(e) => setDriver(e.target.value)}
              className="h-8 rounded-full border border-control-border bg-paper px-3 text-sm"
            >
              <option value="">{t("allDrivers")}</option>
              {drivers.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name ?? m.email ?? m.userId}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-[0.9375rem]">
            <thead>
              <tr>
                <th className={th}>{t("columns.date")}</th>
                <th className={th}>{t("columns.driver")}</th>
                <th className={th}>{t("columns.load")}</th>
                <th className={th}>{t("columns.truck")}</th>
                <th className={cn(th, "text-right")}>{t("columns.weight")}</th>
                <th className={th}>{t("columns.asLoaded")}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((inspection) => (
                <tr
                  key={inspection.id}
                  className="cursor-pointer hover:bg-surface/40"
                  onClick={() => router.push(`/app/inspection?id=${inspection.id}`)}
                >
                  <td className={cn(td, "font-mono text-[0.875rem] whitespace-nowrap")}>{dates.short(inspection.created_at)}</td>
                  <td className={td}>{inspection.author_name ?? "—"}</td>
                  <td className={td}>
                    <Link href={`/app/inspection?id=${inspection.id}`} className="font-[450] text-ink hover:underline">
                      {inspection.title}
                    </Link>
                  </td>
                  <td className={cn(td, "text-gray")}>{truck(inspection.truck_body, inspection.truck_size)}</td>
                  <td className={cn(td, "text-right font-mono text-[0.875rem]")}>
                    {inspection.cargo_weight_kg ? `${inspection.cargo_weight_kg.toLocaleString()} kg` : "—"}
                  </td>
                  <td className={td}>
                    <InspectionVerdict inspection={inspection} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="mt-16 grid gap-14 lg:grid-cols-[3fr_2fr]">
        <section>
          <h2 className="type-label">{t("membersLabel")}</h2>
          <table className="mt-4 w-full border-collapse text-[0.9375rem]">
            <thead>
              <tr>
                <th className={th}>{t("memberColumns.name")}</th>
                <th className={th}>{t("memberColumns.role")}</th>
                <th className={cn(th, "text-right")}>{t("memberColumns.inspections")}</th>
                <th className={th}>{t("memberColumns.last")}</th>
              </tr>
            </thead>
            <tbody>
              {org.members.map((m) => (
                <tr key={m.userId}>
                  <td className={td}>
                    <span className="text-ink">{m.name ?? "—"}</span>
                    {m.email && <span className="type-small block text-gray">{m.email}</span>}
                  </td>
                  <td className={cn(td, "text-gray")}>{t(`roles.${m.role}`)}</td>
                  <td className={cn(td, "text-right font-mono text-[0.875rem]")}>{m.inspections}</td>
                  <td className={cn(td, "font-mono text-[0.875rem] text-gray")}>
                    {m.last_inspection_at ? dates.short(m.last_inspection_at) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <InviteForm demo={Boolean(me?.user.is_demo)} invitations={org.invitations} />
      </div>
    </div>
  );
}

function InviteForm({ demo, invitations }: { demo: boolean; invitations: OrgData["invitations"] }) {
  const t = useTranslations("Org");
  const request = useAppApi();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>("member");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState(invitations);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const invitation = await request<OrgData["invitations"][number]>("/org/invitations", {
        method: "POST",
        body: JSON.stringify({ email, role }),
      });
      setPending((list) => [invitation, ...list]);
      setMessage({ ok: true, text: t("inviteSent", { email }) });
      setEmail("");
    } catch (error) {
      const code = error instanceof AppApiError ? error.code : "failed";
      setMessage({ ok: false, text: code === "invalid_email" ? t("errors.invalid_email") : t("errors.failed") });
    } finally {
      setBusy(false);
    }
  }

  const field = "h-10 w-full rounded-[4px] border border-control-border bg-white px-3 text-[0.9375rem]";
  return (
    <section>
      <h2 className="type-label">{t("inviteLabel")}</h2>
      <form onSubmit={submit} className="mt-4 grid gap-3">
        <label className="type-small text-gray">
          {t("inviteEmail")}
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} disabled={demo} className={cn(field, "mt-1")} />
        </label>
        <label className="type-small text-gray">
          {t("inviteRole")}
          <select value={role} onChange={(e) => setRole(e.target.value as OrgRole)} disabled={demo} className={cn(field, "mt-1")}>
            <option value="member">{t("roles.member")}</option>
            <option value="org_admin">{t("roles.org_admin")}</option>
          </select>
        </label>
        <div>
          <button type="submit" disabled={demo || busy} className={pill()}>
            {t("inviteSend")}
          </button>
        </div>
        {demo && <p className="type-small text-gray">{t("inviteDemo")}</p>}
        {message && (
          <p role="status" className={cn("type-small", message.ok ? "text-pass" : "text-fail")}>
            {message.text}
          </p>
        )}
      </form>
      <h3 className="type-label mt-10">{t("pendingLabel")}</h3>
      {pending.length === 0 ? (
        <p className="type-small mt-3 text-gray">{t("none")}</p>
      ) : (
        <ul className="mt-3">
          {pending.map((i) => (
            <li key={i.id} className="type-small flex justify-between border-t border-hairline py-2">
              <span>{i.email}</span>
              <span className="text-gray">{t(`roles.${i.role}`)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
