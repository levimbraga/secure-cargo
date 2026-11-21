/**
 * Clerk answers a failed sign-in, sign-up or password reset with an error code. The page shows
 * our own sentence for each code it knows, in the page's language, and a generic one otherwise.
 * Keys live in `Auth.form.errors` in the message files.
 */
export const AUTH_ERROR_KEYS = [
  "wrong_password",
  "no_account",
  "account_exists",
  "weak_password",
  "short_password",
  "invalid_email",
  "wrong_code",
  "code_expired",
  "too_many",
  "invite_used",
  "failed",
] as const;

export type AuthErrorKey = (typeof AUTH_ERROR_KEYS)[number];

const BY_CODE: Record<string, AuthErrorKey> = {
  form_password_incorrect: "wrong_password",
  form_password_or_identifier_incorrect: "wrong_password",
  form_identifier_not_found: "no_account",
  form_identifier_exists: "account_exists",
  form_password_pwned: "weak_password",
  form_password_validation_failed: "weak_password",
  form_password_not_strong_enough: "weak_password",
  form_password_size_in_bytes_exceeded: "weak_password",
  form_password_length_too_short: "short_password",
  form_param_format_invalid: "invalid_email",
  form_param_nil: "invalid_email",
  form_code_incorrect: "wrong_code",
  verification_failed: "wrong_code",
  verification_expired: "code_expired",
  too_many_requests: "too_many",
  user_locked: "too_many",
  ticket_expired: "invite_used",
  ticket_invalid: "invite_used",
  revoked_invitation: "invite_used",
  invitation_already_accepted: "invite_used",
};

/** The first error code in a Clerk error (an API response error carries a list). */
export function clerkErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const list = (error as { errors?: { code?: string }[] }).errors;
  if (Array.isArray(list) && list[0]?.code) return list[0].code;
  const code = (error as { code?: string }).code;
  return typeof code === "string" ? code : null;
}

/** Which of our sentences explains this error. */
export function authErrorKey(error: unknown): AuthErrorKey {
  const code = clerkErrorCode(error);
  return (code && BY_CODE[code]) || "failed";
}

/** The minimum password length we ask for (Clerk's own minimum is 8). */
export const MIN_PASSWORD_LENGTH = 8;

/** A quick local check before any request, so the obvious mistakes answer at once. */
export function localAuthError(email: string, password?: string): AuthErrorKey | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return "invalid_email";
  if (password !== undefined && password.length < MIN_PASSWORD_LENGTH) return "short_password";
  return null;
}
