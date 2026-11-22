"use client";

import { cn } from "cn";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";

import { pill } from "@/components/ui/pill";
import { Link } from "@/i18n/navigation";
import { API_URL } from "@/lib/api";
import { CONTACT_ERRORS as ERRORS, type ContactError, LIMITS, SUBJECTS, validateContact } from "@/lib/contact";
import { TURNSTILE_SITE_KEY } from "@/lib/site";

const FIELD_OF: Partial<Record<ContactError, "name" | "email" | "subject" | "message">> = {
  invalid_name: "name",
  invalid_email: "email",
  invalid_subject: "subject",
  invalid_message: "message",
  html_not_allowed: "message",
};

type TurnstileApi = {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
};
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  return new Promise((resolve, reject) => {
    let script = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT}"]`);
    if (!script) {
      script = document.createElement("script");
      script.src = SCRIPT;
      script.async = true;
      document.head.appendChild(script);
    }
    script.addEventListener("load", () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("no turnstile"))));
    script.addEventListener("error", () => reject(new Error("turnstile script failed")));
  });
}

/** The Turnstile widget (managed, shown only when Cloudflare needs an interaction). */
function useTurnstile(locale: string) {
  const ref = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const [token, setToken] = useState("");
  const [failed, setFailed] = useState(false);
  // With `interaction-only` the widget is invisible unless Cloudflare asks the visitor to click it.
  const [interactive, setInteractive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadTurnstile().then(
      (api) => {
        if (cancelled || !ref.current) return;
        widget.current = api.render(ref.current, {
          sitekey: TURNSTILE_SITE_KEY,
          action: "contact",
          appearance: "interaction-only",
          size: "flexible",
          theme: "light",
          language: locale === "pt-BR" ? "pt-br" : "en",
          callback: (value: string) => {
            setToken(value);
            setFailed(false);
          },
          "expired-callback": () => setToken(""),
          "before-interactive-callback": () => setInteractive(true),
          "after-interactive-callback": () => setInteractive(false),
          "error-callback": () => {
            setToken("");
            setFailed(true);
          },
        });
      },
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = null;
    };
  }, [locale]);

  /** A token is single-use: ask for a new one after every attempt. */
  const reset = () => {
    setToken("");
    if (widget.current) window.turnstile?.reset(widget.current);
  };
  return { ref, token, failed, interactive, reset };
}

const fieldClass =
  "mt-1 w-full rounded-[4px] border border-control-border bg-white px-3 text-base text-ink outline-none focus-visible:border-ink aria-[invalid=true]:border-fail";

export function ContactForm() {
  const t = useTranslations("Contact");
  const locale = useLocale();
  const ids = { name: useId(), email: useId(), emailHint: useId(), subject: useId(), message: useId(), count: useId(), error: useId() };
  const [form, setForm] = useState({ name: "", email: "", subject: "", message: "", website: "" });
  const [error, setError] = useState<ContactError | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ name: string; email: string } | null>(null);
  const { ref: turnstileRef, token: turnstileToken, failed: turnstileFailed, interactive: turnstileShown, reset: resetTurnstile } = useTurnstile(locale);
  const errorField = error ? FIELD_OF[error] : undefined;

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    if (error && FIELD_OF[error] === key) setError(null);
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const invalid = validateContact(form);
    if (invalid) {
      setError(invalid);
      document.getElementById(ids[FIELD_OF[invalid] ?? "name"])?.focus();
      return;
    }
    if (!turnstileToken) {
      setError(turnstileFailed ? "turnstile_unavailable" : "turnstile_failed");
      return;
    }
    setBusy(true);
    setError(null);
    // The page the visitor wrote from: where they came from on this site, or this page.
    const page = document.referrer && new URL(document.referrer).origin === window.location.origin ? document.referrer : window.location.href;
    try {
      const response = await fetch(`${API_URL}/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, locale, page, turnstile_token: turnstileToken }),
      });
      if (response.ok) {
        setSent({ name: form.name.trim(), email: form.email.trim() });
        setForm({ name: "", email: "", subject: "", message: "", website: "" });
      } else {
        const body = (await response.json().catch(() => null)) as { detail?: { code?: string } } | null;
        const code = body?.detail?.code;
        setError(ERRORS.includes(code as ContactError) ? (code as ContactError) : "unknown");
      }
    } catch {
      setError("network");
    } finally {
      setBusy(false);
      resetTurnstile();
    }
  }

  if (sent) {
    return (
      <div role="status" className="mt-10">
        <h2 className="type-card-title">{t("success.title")}</h2>
        <p className="type-body mt-3">{t("success.body", sent)}</p>
        <button type="button" onClick={() => setSent(null)} className={pill({ variant: "secondary", className: "mt-6" })}>
          {t("success.again")}
        </button>
      </div>
    );
  }

  const count = form.message.trim().length;
  return (
    <form onSubmit={submit} noValidate className="mt-10 grid gap-5" aria-describedby={error ? ids.error : undefined}>
      <label className="type-small block text-gray" htmlFor={ids.name}>
        {t("name")}
        <input
          id={ids.name}
          name="name"
          autoComplete="name"
          required
          maxLength={LIMITS.name}
          value={form.name}
          onChange={set("name")}
          aria-invalid={errorField === "name" || undefined}
          className={cn(fieldClass, "h-12")}
        />
      </label>

      <div>
        <label className="type-small block text-gray" htmlFor={ids.email}>
          {t("email")}
          <input
            id={ids.email}
            type="email"
            name="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            maxLength={LIMITS.email}
            value={form.email}
            onChange={set("email")}
            aria-invalid={errorField === "email" || undefined}
            aria-describedby={ids.emailHint}
            className={cn(fieldClass, "h-12")}
          />
        </label>
        <p id={ids.emailHint} className="type-small mt-1 text-gray">
          {t("emailHint")}
        </p>
      </div>

      <label className="type-small block text-gray" htmlFor={ids.subject}>
        {t("subject")}
        <select
          id={ids.subject}
          name="subject"
          required
          value={form.subject}
          onChange={set("subject")}
          aria-invalid={errorField === "subject" || undefined}
          className={cn(fieldClass, "h-12 appearance-auto", !form.subject && "text-gray")}
        >
          <option value="" disabled>
            {t("subjectPlaceholder")}
          </option>
          {SUBJECTS.map((s) => (
            <option key={s} value={s} className="text-ink">
              {t(`subjects.${s}`)}
            </option>
          ))}
        </select>
      </label>

      <div>
        <label className="type-small block text-gray" htmlFor={ids.message}>
          {t("message")}
          <textarea
            id={ids.message}
            name="message"
            required
            rows={7}
            maxLength={LIMITS.message}
            value={form.message}
            onChange={set("message")}
            aria-invalid={errorField === "message" || undefined}
            aria-describedby={ids.count}
            className={cn(fieldClass, "min-h-40 py-2.5 leading-normal")}
          />
        </label>
        <p id={ids.count} className={cn("type-label mt-1 text-right", count > LIMITS.message * 0.95 && "text-ink")}>
          {t("messageCount", { count, max: LIMITS.message })}
        </p>
      </div>

      {/* Honeypot: hidden from people and from screen readers; bots that fill it are ignored. */}
      <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label>
          {t("honeypot")}
          <input type="text" name="website" tabIndex={-1} autoComplete="off" value={form.website} onChange={set("website")} />
        </label>
      </div>

      {/* Collapsed (and its grid gap cancelled) until the widget needs a click. */}
      <div ref={turnstileRef} className={turnstileShown ? undefined : "-mt-5 h-0 overflow-hidden"} />

      {error && (
        <p id={ids.error} role="alert" className="type-small text-fail">
          {t(`errors.${error}`)}
        </p>
      )}

      <button type="submit" disabled={busy} className={pill({ className: "h-12 w-full text-[0.9375rem] md:w-auto md:justify-self-start md:px-8" })}>
        {busy ? t("sending") : t("send")}
      </button>

      <p className="type-small text-gray">
        {t.rich("privacyNote", {
          link: (chunks) => (
            <Link href="/privacy" className="text-ink underline decoration-hairline underline-offset-4">
              {chunks}
            </Link>
          ),
        })}
      </p>
    </form>
  );
}
