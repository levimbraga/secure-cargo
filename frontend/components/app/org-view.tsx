"use client";

import { cn } from "cn";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { useDates } from "@/components/app/inspection-bits";
import { useMe } from "@/components/app/me-provider";
import { OrgShell } from "@/components/app/org-shell";
import { pill } from "@/components/ui/pill";
import { Link } from "@/i18n/navigation";
import { AppApiError, type OrgPolicies, type OrgRole, type OrgView as OrgData, useAppApi } from "@/lib/app-api";

const th = "type-label h-10 border-b border-hairline px-3 text-left font-normal first:pl-0";
const td = "border-b border-hairline px-3 py-3 align-middle first:pl-0";

export function OrgTeamPage() {
  return <OrgShell>{() => <OrgTeam />}</OrgShell>;
}

/** `/app/org/team`: members and their inspections, invitations, and the organization's policies. */
function OrgTeam() {
  const t = useTranslations("Org");
  const m = useTranslations("Manager");
  const { me } = useMe();
  const request = useAppApi();
  const dates = useDates();
  const [org, setOrg] = useState<OrgData | null>(null);

  useEffect(() => {
    let cancelled = false;
    request<OrgData>("/org")
      .then((value) => !cancelled && setOrg(value))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [request]);

  if (!org) return <p className="type-small text-gray">{m("loading")}</p>;
  const demo = Boolean(me?.user.is_demo);
  return (
    <>
      <h1 className="type-hero text-balance">{org.org.name}</h1>
      <div className="mt-10 grid gap-14 lg:grid-cols-[3fr_2fr]">
        <section>
          <h2 className="type-label">{t("membersLabel")}</h2>
          <div className="overflow-x-auto">
            <table className="mt-4 w-full min-w-[480px] border-collapse text-[0.9375rem]">
              <thead>
                <tr>
                  <th className={th}>{t("memberColumns.name")}</th>
                  <th className={th}>{t("memberColumns.role")}</th>
                  <th className={cn(th, "text-right")}>{t("memberColumns.inspections")}</th>
                  <th className={th}>{t("memberColumns.last")}</th>
                </tr>
              </thead>
              <tbody>
                {org.members.map((member) => (
                  <tr key={member.userId}>
                    <td className={td}>
                      <span className="text-ink">{member.name ?? "—"}</span>
                      {member.email && <span className="type-small block text-gray">{member.email}</span>}
                    </td>
                    <td className={cn(td, "text-gray")}>{t(`roles.${member.role}`)}</td>
                    <td className={cn(td, "text-right font-mono text-[0.875rem]")}>
                      <Link href={`/app/org/inspections?driver=${encodeURIComponent(member.userId)}`} className="hover:underline">
                        {member.inspections}
                      </Link>
                    </td>
                    <td className={cn(td, "font-mono text-[0.875rem] text-gray")}>
                      {member.last_inspection_at ? dates.short(member.last_inspection_at) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {org.policies && <Policies initial={org.policies} demo={demo} />}
        </section>
        <InviteForm demo={demo} invitations={org.invitations} />
      </div>
    </>
  );
}

function Policies({ initial, demo }: { initial: OrgPolicies; demo: boolean }) {
  const t = useTranslations("Manager.team");
  const request = useAppApi();
  const { refresh } = useMe();
  const [policies, setPolicies] = useState(initial);
  const [hours, setHours] = useState(String(initial.alert_after_hours));
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      const saved = await request<OrgPolicies>("/org/policies", {
        method: "PATCH",
        body: JSON.stringify({ ...policies, alert_after_hours: Number(hours) }),
      });
      setPolicies(saved);
      setHours(String(saved.alert_after_hours));
      setStatus({ ok: true, text: t("saved") });
      refresh();
    } catch {
      setStatus({ ok: false, text: t("failed") });
    } finally {
      setBusy(false);
    }
  }

  const toggle = (key: "require_two_photos" | "certificate_requires_compliance", label: string, hint: string) => (
    <label className="flex cursor-pointer items-start gap-3 border-t border-hairline py-4">
      <input
        type="checkbox"
        checked={policies[key]}
        disabled={demo}
        onChange={(e) => setPolicies((p) => ({ ...p, [key]: e.target.checked }))}
        className="mt-1 size-4 accent-ink"
      />
      <span>
        <span className="block text-[0.9375rem] text-ink">{label}</span>
        <span className="type-small mt-0.5 block text-gray">{hint}</span>
      </span>
    </label>
  );

  return (
    <form onSubmit={save} className="mt-14" data-testid="policies">
      <h2 className="type-label">{t("policies")}</h2>
      <p className="type-small mt-2 text-gray">{t("policiesSentence")}</p>
      <div className="mt-4 border-b border-hairline">
        {toggle("require_two_photos", t("twoPhotos"), t("twoPhotosHint"))}
        {toggle("certificate_requires_compliance", t("compliance"), t("complianceHint"))}
        <label className="flex items-start gap-3 border-t border-hairline py-4">
          <input
            type="number"
            min={1}
            max={720}
            step={1}
            required
            value={hours}
            disabled={demo}
            onChange={(e) => setHours(e.target.value)}
            className="h-9 w-20 rounded-[4px] border border-control-border bg-white px-2 font-mono text-[0.9375rem]"
          />
          <span>
            <span className="block text-[0.9375rem] text-ink">{t("alertHours")}</span>
            <span className="type-small mt-0.5 block text-gray">{t("alertHoursHint")}</span>
          </span>
        </label>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={demo || busy} className={pill()}>
          {t("save")}
        </button>
        {demo && <span className="type-small text-gray">{t("demo")}</span>}
        {status && (
          <span role="status" className={cn("type-small", status.ok ? "text-pass" : "text-fail")}>
            {status.text}
          </span>
        )}
      </div>
    </form>
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
