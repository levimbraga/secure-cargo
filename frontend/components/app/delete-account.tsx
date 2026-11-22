"use client";

import { useClerk } from "@clerk/nextjs";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";

import { useMe } from "@/components/app/me-provider";
import { pill } from "@/components/ui/pill";
import { AppApiError, requestWithToken } from "@/lib/app-api";

/**
 * "Delete my account": a dialog that asks the person to type a word before calling `DELETE /me`.
 * The word is in their language; the API always receives "DELETE". Afterwards the session ends.
 */
export function DeleteAccountDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations("Account.delete");
  const locale = useLocale();
  const clerk = useClerk();
  const { getToken, me } = useMe();
  const ref = useRef<HTMLDialogElement>(null);
  const inputId = useId();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const word = t("word");

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function close() {
    if (busy || done) return;
    setTyped("");
    setError(null);
    onClose();
  }

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    if (busy || typed.trim().toUpperCase() !== word.toUpperCase()) return;
    setBusy(true);
    setError(null);
    try {
      await requestWithToken(getToken, "/me", { method: "DELETE", body: JSON.stringify({ confirm: "DELETE" }) });
      setDone(true);
      const home = locale === "pt-BR" ? "/pt-BR" : "/";
      window.setTimeout(() => void clerk.signOut({ redirectUrl: home }), 1800);
    } catch (e) {
      setError(e instanceof AppApiError && e.code === "identity_delete_failed" ? t("errorRetry") : t("error"));
      setBusy(false);
    }
  }

  const org = me?.org?.name ?? null;
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      aria-labelledby={`${inputId}-title`}
      className="m-auto w-[calc(100%-2rem)] max-w-[30rem] rounded bg-paper p-6 text-ink backdrop:bg-ink/40"
    >
      {done ? (
        <div role="status">
          <h2 id={`${inputId}-title`} className="type-card-title">
            {t("doneTitle")}
          </h2>
          <p className="type-body mt-3">{t("doneBody")}</p>
        </div>
      ) : (
        <form onSubmit={confirm} className="grid gap-4">
          <h2 id={`${inputId}-title`} className="type-card-title">
            {t("title")}
          </h2>
          <ul className="type-small flex list-disc flex-col gap-1.5 pl-5 text-gray">
            <li>{t("personal")}</li>
            <li>{org ? t("orgNamed", { org }) : t("org")}</li>
            <li>{t("final")}</li>
          </ul>
          <label htmlFor={inputId} className="type-small block text-gray">
            {t.rich("typeToConfirm", { word: () => <strong className="font-mono text-ink">{word}</strong> })}
            <input
              id={inputId}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className="mt-1 h-12 w-full rounded-[4px] border border-control-border bg-white px-3 font-mono text-base text-ink outline-none focus-visible:border-ink"
            />
          </label>
          {error && (
            <p role="alert" className="type-small text-fail">
              {error}
            </p>
          )}
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <button type="button" onClick={close} disabled={busy} className={pill({ variant: "secondary", className: "h-10 px-4" })}>
              {t("cancel")}
            </button>
            <button
              type="submit"
              disabled={busy || typed.trim().toUpperCase() !== word.toUpperCase()}
              className={pill({ className: "h-10 bg-fail px-4 text-paper hover:bg-fail/85" })}
            >
              {busy ? t("deleting") : t("confirm")}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
