"use client";

import { useOrganizationList, useUser } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { CreateOrg } from "@/components/app/create-org";
import { useMe } from "@/components/app/me-provider";
import { pill } from "@/components/ui/pill";
import { Link, useRouter } from "@/i18n/navigation";

/**
 * After the first sign-in with no organization: one simple choice, "I was invited by my company"
 * (pending invitations for this email, joined with one tap) or "Create my company".
 */
export function OrgChoice() {
  const t = useTranslations("OrgChoice");
  const { me } = useMe();
  const router = useRouter();
  const [choice, setChoice] = useState<"invited" | "create" | null>(null);

  if (choice === "create") {
    return (
      <div>
        <BackButton onClick={() => setChoice(null)} />
        <div className="-mx-4 mt-6">
          {/* The creator is the new company's manager: open its overview. */}
          <CreateOrg onCreated={() => router.push("/app/org")} />
        </div>
      </div>
    );
  }
  if (choice === "invited") return <Invitations onBack={() => setChoice(null)} />;

  const card =
    "flex min-h-24 w-full flex-col items-start justify-center gap-1 rounded-[6px] border border-hairline bg-white px-5 py-4 text-left hover:border-ink focus-visible:border-ink";
  return (
    <div className="max-w-[520px]">
      <p className="type-label">{t("label")}</p>
      <h1 className="type-hero mt-5 text-balance">{t("title")}</h1>
      <p className="type-body mt-4">{t("sentence")}</p>
      <div className="mt-8 grid gap-3">
        <button type="button" onClick={() => setChoice("invited")} className={card}>
          <span className="text-[1.0625rem] font-[450] text-ink">{t("invited")}</span>
          <span className="type-small text-gray">{t("invitedNote")}</span>
        </button>
        <button type="button" onClick={() => setChoice("create")} className={card}>
          <span className="text-[1.0625rem] font-[450] text-ink">{t("create")}</span>
          <span className="type-small text-gray">{t("createNote")}</span>
        </button>
      </div>
      {me?.is_platform_admin && (
        <Link href="/app/admin" className="type-small mt-6 inline-block text-ink underline underline-offset-4">
          {t("admin")}
        </Link>
      )}
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  const t = useTranslations("OrgChoice");
  return (
    <button type="button" onClick={onClick} className="type-small text-ink underline underline-offset-4">
      ← {t("back")}
    </button>
  );
}

function Invitations({ onBack }: { onBack: () => void }) {
  const t = useTranslations("OrgChoice");
  const { user } = useUser();
  const { refresh } = useMe();
  const { isLoaded, setActive, userInvitations } = useOrganizationList({ userInvitations: { status: "pending" } });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const email = user?.primaryEmailAddress?.emailAddress ?? "";
  const invitations = userInvitations?.data ?? [];

  async function accept(invitation: (typeof invitations)[number]) {
    setBusy(invitation.id);
    setError(false);
    try {
      await invitation.accept();
      await setActive?.({ organization: invitation.publicOrganizationData.id });
      refresh();
    } catch {
      setError(true);
      setBusy(null);
    }
  }

  return (
    <div className="max-w-[520px]">
      <BackButton onClick={onBack} />
      <h1 className="type-hero mt-6 text-balance">{t("invitedTitle")}</h1>
      {!isLoaded ? null : invitations.length > 0 ? (
        <>
          <p className="type-body mt-4">{t("pending", { email })}</p>
          <ul className="mt-6 grid gap-3">
            {invitations.map((invitation) => (
              <li key={invitation.id}>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => accept(invitation)}
                  className={pill({ className: "h-12 w-full text-[0.9375rem]" })}
                >
                  {busy === invitation.id ? t("joining") : t("accept", { org: invitation.publicOrganizationData.name })}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <p className="type-body mt-4">{t("none", { email })}</p>
          <button
            type="button"
            onClick={() => userInvitations?.revalidate?.()}
            className={pill({ variant: "secondary", className: "mt-6 h-11 px-4" })}
          >
            {t("check")}
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="type-small mt-3 text-fail">
          {t("failed")}
        </p>
      )}
    </div>
  );
}
