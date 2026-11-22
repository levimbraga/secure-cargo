"use client";

import { useAuth, useClerk, useSignIn, useSignUp } from "@clerk/nextjs";
import { cn } from "cn";
import { useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";

import { DemoButtons } from "@/components/app/demo-buttons";
import { useMe } from "@/components/app/me-provider";
import { pill } from "@/components/ui/pill";
import { Link, useRouter } from "@/i18n/navigation";
import { type AuthErrorKey, authErrorKey, localAuthError, passwordMinLength } from "@/lib/auth-errors";

export type AuthTab = "sign-in" | "sign-up";

type Invite = { ticket: string; status: "sign_up" | "sign_in" | "complete" };

/** Clerk's invitation links land here with the ticket and what the invitee must do next. */
function readInvite(): Invite | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const ticket = params.get("__clerk_ticket");
  const status = params.get("__clerk_status");
  if (!ticket || (status !== "sign_up" && status !== "sign_in" && status !== "complete")) return null;
  return { ticket, status };
}

/**
 * The sign-in screen: one page, two tabs ("Sign in" / "Create account"), email and password only,
 * "Forgot password?" by an emailed code, and the demo buttons under "Just looking?". Built on
 * Clerk's hooks so it follows our design system and our two languages.
 */
export function AuthPanel({ initial = "sign-in" }: { initial?: AuthTab }) {
  const t = useTranslations("Auth");
  const { isLoaded, isSignedIn } = useAuth({ treatPendingAsSignedOut: false });
  const [tab, setTab] = useState<AuthTab>(initial);
  // Read on the client (the page is static). The forms render only once Clerk has loaded,
  // after hydration, so the server and the first client render agree.
  const [invite] = useState<Invite | null>(readInvite);

  return (
    <div className="max-w-[420px]">
      <p className="type-label">{t("label")}</p>
      <h1 className="type-hero mt-5 text-balance">{t("title")}</h1>
      <p className="type-body mt-5">{t("sentence")}</p>

      {isLoaded && !isSignedIn && (
        <div className="mt-10">
          {invite ? (
            <InvitedForm invite={invite} />
          ) : (
            <>
              <div role="tablist" aria-label={t("form.tabs")} className="flex border-b border-hairline">
                {(["sign-in", "sign-up"] as const).map((id) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    id={`auth-tab-${id}`}
                    aria-selected={tab === id}
                    aria-controls={`auth-panel-${id}`}
                    onClick={() => setTab(id)}
                    className={cn(
                      "-mb-px h-11 flex-1 border-b-2 px-3 text-[0.9375rem]",
                      tab === id ? "border-ink text-ink" : "border-transparent text-gray hover:text-ink",
                    )}
                  >
                    {t(id === "sign-in" ? "form.signInTab" : "form.signUpTab")}
                  </button>
                ))}
              </div>
              <div role="tabpanel" id={`auth-panel-${tab}`} aria-labelledby={`auth-tab-${tab}`} className="pt-6">
                {tab === "sign-in" ? <SignInForm /> : <SignUpForm onHaveAccount={() => setTab("sign-in")} />}
              </div>
            </>
          )}
        </div>
      )}

      <h2 className="type-label mt-14">{t("demoLabel")}</h2>
      <div className="mt-4">
        <DemoButtons />
      </div>
    </div>
  );
}

/** The live minimum password length of the Clerk instance (falls back to 8). */
function useMinLength(): number {
  const clerk = useClerk() as unknown as { __internal_environment?: unknown };
  return passwordMinLength(clerk.__internal_environment);
}

const fieldClass =
  "mt-1 h-12 w-full rounded-[4px] border border-control-border bg-white px-3 text-base text-ink outline-none focus-visible:border-ink aria-[invalid=true]:border-fail";

function EmailField({ value, onChange, invalid }: { value: string; onChange: (v: string) => void; invalid?: boolean }) {
  const t = useTranslations("Auth.form");
  return (
    <label className="type-small block text-gray">
      {t("email")}
      <input
        type="email"
        name="email"
        inputMode="email"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid || undefined}
        className={fieldClass}
      />
    </label>
  );
}

function PasswordField({
  value,
  onChange,
  label,
  autoComplete,
  invalid,
  hint,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  autoComplete: "current-password" | "new-password";
  invalid?: boolean;
  hint?: string;
}) {
  const t = useTranslations("Auth.form");
  const min = useMinLength();
  const [shown, setShown] = useState(false);
  const hintId = useId();
  return (
    <div>
      <label className="type-small block text-gray">
        {label}
        <span className="relative block">
          <input
            type={shown ? "text" : "password"}
            name="password"
            autoComplete={autoComplete}
            required
            minLength={autoComplete === "new-password" ? min : undefined}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={invalid || undefined}
            aria-describedby={hint ? hintId : undefined}
            className={cn(fieldClass, "pr-20")}
          />
          <button
            type="button"
            onClick={() => setShown((s) => !s)}
            aria-pressed={shown}
            className="absolute top-1 right-1 h-10 rounded-[4px] px-3 text-sm text-gray hover:text-ink"
          >
            {shown ? t("hide") : t("show")}
          </button>
        </span>
      </label>
      {hint && (
        <p id={hintId} className="type-small mt-1 text-gray">
          {hint}
        </p>
      )}
    </div>
  );
}

function CodeField({ value, onChange, invalid }: { value: string; onChange: (v: string) => void; invalid?: boolean }) {
  const t = useTranslations("Auth.form");
  return (
    <label className="type-small block text-gray">
      {t("code")}
      <input
        type="text"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        required
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
        aria-invalid={invalid || undefined}
        className={cn(fieldClass, "font-mono tracking-[0.3em]")}
      />
    </label>
  );
}

function FormError({ error }: { error: AuthErrorKey | null }) {
  const t = useTranslations("Auth.form.errors");
  const min = useMinLength();
  if (!error) return null;
  return (
    <p role="alert" className="type-small text-fail">
      {t(error, { min })}
    </p>
  );
}

function Submit({ busy, label, busyLabel }: { busy: boolean; label: string; busyLabel: string }) {
  return (
    <button type="submit" disabled={busy} className={pill({ className: "h-12 w-full text-[0.9375rem]" })}>
      {busy ? busyLabel : label}
    </button>
  );
}

/** Under the sign-up buttons: creating an account means agreeing to the terms and the privacy policy. */
function Consent() {
  const t = useTranslations("Auth.form");
  const link = (href: "/terms" | "/privacy") => {
    function ConsentLink(chunks: React.ReactNode) {
      return (
        <Link href={href} className="text-ink underline decoration-hairline underline-offset-4">
          {chunks}
        </Link>
      );
    }
    return ConsentLink;
  };
  return <p className="type-small -mt-2 text-gray">{t.rich("consent", { terms: link("/terms"), privacy: link("/privacy") })}</p>;
}

/** Send the signed-in user to their home; `/app` decides between inspections and the org choice. */
function useGoHome() {
  const router = useRouter();
  const { demo, exitDemo } = useMe();
  return () => {
    // A real account replaces a demo session left in this browser.
    if (demo) void exitDemo();
    router.push("/app");
  };
}

function SignInForm() {
  const t = useTranslations("Auth.form");
  const { signIn } = useSignIn();
  const goHome = useGoHome();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AuthErrorKey | null>(null);
  const [resetting, setResetting] = useState(false);

  if (resetting) return <ResetForm initialEmail={email} onDone={goHome} onBack={() => setResetting(false)} />;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const local = localAuthError(email);
    if (local) return setError(local);
    setBusy(true);
    setError(null);
    const attempt = await signIn.password({ identifier: email.trim(), password });
    const done = attempt.error ? attempt : await signIn.finalize();
    if (done.error) {
      setError(authErrorKey(done.error));
      setBusy(false);
      return;
    }
    goHome();
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-5">
      <EmailField value={email} onChange={setEmail} invalid={error === "invalid_email" || error === "no_account"} />
      <PasswordField
        value={password}
        onChange={setPassword}
        label={t("password")}
        autoComplete="current-password"
        invalid={error === "wrong_password"}
      />
      <FormError error={error} />
      <Submit busy={busy} label={t("signIn")} busyLabel={t("signingIn")} />
      <button type="button" onClick={() => setResetting(true)} className="type-small justify-self-start text-ink underline underline-offset-4">
        {t("forgot")}
      </button>
    </form>
  );
}

function ResetForm({ initialEmail, onDone, onBack }: { initialEmail: string; onDone: () => void; onBack: () => void }) {
  const t = useTranslations("Auth.form");
  const min = useMinLength();
  const { signIn } = useSignIn();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AuthErrorKey | null>(null);

  async function sendCode(event: React.FormEvent) {
    event.preventDefault();
    const local = localAuthError(email);
    if (local) return setError(local);
    setBusy(true);
    setError(null);
    const created = await signIn.create({ identifier: email.trim() });
    const sent = created.error ? created : await signIn.resetPasswordEmailCode.sendCode();
    setBusy(false);
    if (sent.error) return setError(authErrorKey(sent.error));
    setStep("code");
  }

  async function reset(event: React.FormEvent) {
    event.preventDefault();
    if (password.length < min) return setError("short_password");
    setBusy(true);
    setError(null);
    const verified = await signIn.resetPasswordEmailCode.verifyCode({ code });
    const saved = verified.error ? verified : await signIn.resetPasswordEmailCode.submitPassword({ password, signOutOfOtherSessions: true });
    const done = saved.error ? saved : await signIn.finalize();
    if (done.error) {
      setError(authErrorKey(done.error));
      setBusy(false);
      return;
    }
    onDone();
  }

  return step === "email" ? (
    <form onSubmit={sendCode} noValidate className="grid gap-5">
      <div>
        <h2 className="text-[1.0625rem] font-[450] text-ink">{t("resetTitle")}</h2>
        <p className="type-small mt-1 text-gray">{t("resetSentence")}</p>
      </div>
      <EmailField value={email} onChange={setEmail} invalid={error === "invalid_email" || error === "no_account"} />
      <FormError error={error} />
      <Submit busy={busy} label={t("sendCode")} busyLabel={t("sending")} />
      <button type="button" onClick={onBack} className="type-small justify-self-start text-ink underline underline-offset-4">
        {t("backToSignIn")}
      </button>
    </form>
  ) : (
    <form onSubmit={reset} noValidate className="grid gap-5">
      <div>
        <h2 className="text-[1.0625rem] font-[450] text-ink">{t("resetTitle")}</h2>
        <p className="type-small mt-1 text-gray">{t("codeSent", { email: email.trim() })}</p>
      </div>
      <CodeField value={code} onChange={setCode} invalid={error === "wrong_code" || error === "code_expired"} />
      <PasswordField
        value={password}
        onChange={setPassword}
        label={t("newPassword")}
        autoComplete="new-password"
        invalid={error === "weak_password" || error === "short_password"}
        hint={t("passwordHint", { min })}
      />
      <FormError error={error} />
      <Submit busy={busy} label={t("savePassword")} busyLabel={t("saving")} />
      <button type="button" onClick={onBack} className="type-small justify-self-start text-ink underline underline-offset-4">
        {t("backToSignIn")}
      </button>
    </form>
  );
}

function SignUpForm({ onHaveAccount }: { onHaveAccount: () => void }) {
  const t = useTranslations("Auth.form");
  const min = useMinLength();
  const { signUp } = useSignUp();
  const goHome = useGoHome();
  const [step, setStep] = useState<"details" | "code">("details");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AuthErrorKey | null>(null);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    const local = localAuthError(email, password, min);
    if (local) return setError(local);
    setBusy(true);
    setError(null);
    const created = await signUp.password({ emailAddress: email.trim(), password });
    const sent = created.error ? created : await signUp.verifications.sendEmailCode();
    setBusy(false);
    if (sent.error) return setError(authErrorKey(sent.error));
    setStep("code");
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const verified = await signUp.verifications.verifyEmailCode({ code });
    const done = verified.error ? verified : await signUp.finalize();
    if (done.error) {
      setError(authErrorKey(done.error));
      setBusy(false);
      return;
    }
    goHome();
  }

  async function resend() {
    setError(null);
    const sent = await signUp.verifications.sendEmailCode();
    if (sent.error) setError(authErrorKey(sent.error));
  }

  return step === "details" ? (
    <form onSubmit={create} noValidate className="grid gap-5">
      <EmailField value={email} onChange={setEmail} invalid={error === "invalid_email" || error === "account_exists"} />
      <PasswordField
        value={password}
        onChange={setPassword}
        label={t("password")}
        autoComplete="new-password"
        invalid={error === "weak_password" || error === "short_password"}
        hint={t("passwordHint", { min })}
      />
      <FormError error={error} />
      {error === "account_exists" && (
        <button type="button" onClick={onHaveAccount} className="type-small -mt-3 justify-self-start text-ink underline underline-offset-4">
          {t("signInInstead")}
        </button>
      )}
      {/* Clerk's bot protection draws its challenge here when it needs one. */}
      <div id="clerk-captcha" />
      <Submit busy={busy} label={t("createAccount")} busyLabel={t("creating")} />
      <Consent />
    </form>
  ) : (
    <form onSubmit={verify} noValidate className="grid gap-5">
      <div>
        <h2 className="text-[1.0625rem] font-[450] text-ink">{t("verifyTitle")}</h2>
        <p className="type-small mt-1 text-gray">{t("codeSent", { email: email.trim() })}</p>
      </div>
      <CodeField value={code} onChange={setCode} invalid={error === "wrong_code" || error === "code_expired"} />
      <FormError error={error} />
      <Submit busy={busy} label={t("verify")} busyLabel={t("verifying")} />
      <button type="button" onClick={resend} className="type-small justify-self-start text-ink underline underline-offset-4">
        {t("resend")}
      </button>
    </form>
  );
}

/** An emailed invitation: a new person chooses a password; an existing account just signs in. */
function InvitedForm({ invite }: { invite: Invite }) {
  const t = useTranslations("Auth.form");
  const min = useMinLength();
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();
  const goHome = useGoHome();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(invite.status === "sign_in");
  const [error, setError] = useState<AuthErrorKey | null>(null);

  // An invitee who already has an account is signed in by the ticket alone.
  useEffect(() => {
    if (invite.status !== "sign_in") return;
    let cancelled = false;
    void (async () => {
      const attempt = await signIn.ticket({ ticket: invite.ticket });
      const done = attempt.error ? attempt : await signIn.finalize();
      if (cancelled) return;
      if (done.error) {
        setError(authErrorKey(done.error));
        setBusy(false);
      } else goHome();
    })();
    return () => {
      cancelled = true;
    };
    // Run once per ticket.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invite.ticket, invite.status]);

  async function accept(event: React.FormEvent) {
    event.preventDefault();
    if (password.length < min) return setError("short_password");
    setBusy(true);
    setError(null);
    const created = await signUp.create({ strategy: "ticket", ticket: invite.ticket, password });
    const done = created.error ? created : await signUp.finalize();
    if (done.error) {
      setError(authErrorKey(done.error));
      setBusy(false);
      return;
    }
    goHome();
  }

  if (invite.status === "complete") return <p className="type-body">{t("inviteComplete")}</p>;
  if (invite.status === "sign_in") {
    return error ? <FormError error={error} /> : <p className="type-body" role="status">{t("inviteSigningIn")}</p>;
  }
  return (
    <form onSubmit={accept} noValidate className="grid gap-5">
      <div>
        <h2 className="text-[1.0625rem] font-[450] text-ink">{t("inviteTitle")}</h2>
        <p className="type-small mt-1 text-gray">{t("inviteSentence")}</p>
      </div>
      <PasswordField
        value={password}
        onChange={setPassword}
        label={t("choosePassword")}
        autoComplete="new-password"
        invalid={error === "weak_password" || error === "short_password"}
        hint={t("passwordHint", { min })}
      />
      <FormError error={error} />
      <div id="clerk-captcha" />
      <Submit busy={busy} label={t("acceptInvite")} busyLabel={t("creating")} />
      <Consent />
    </form>
  );
}
