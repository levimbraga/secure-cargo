/** The contact form's rules, shared by the form and its tests; the same limits the Worker enforces (`backend/worker/src/contact.ts`). */
export const LIMITS = { name: 100, email: 254, message: 2000, messageMin: 10 } as const;
export const SUBJECTS = ["general", "insurers", "partnership", "press", "privacy", "problem"] as const;
type Subject = (typeof SUBJECTS)[number];

export const CONTACT_ERRORS = [
  "invalid_name",
  "invalid_email",
  "invalid_subject",
  "invalid_message",
  "html_not_allowed",
  "turnstile_failed",
  "turnstile_unavailable",
  "rate_limited",
  "contact_hourly_limit",
  "send_failed",
  "contact_unavailable",
  "network",
  "unknown",
] as const;
export type ContactError = (typeof CONTACT_ERRORS)[number];

const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;
const HTML = /<\s*\/?\s*[a-z!][^>]*>/i;

/** The checks the browser can make before sending; the server repeats every one. */
export function validateContact(form: { name: string; email: string; subject: string; message: string }): ContactError | null {
  const name = form.name.trim();
  if (!name || name.length > LIMITS.name || HTML.test(name)) return "invalid_name";
  const email = form.email.trim();
  if (!email || email.length > LIMITS.email || !EMAIL.test(email)) return "invalid_email";
  if (!SUBJECTS.includes(form.subject as Subject)) return "invalid_subject";
  const message = form.message.trim();
  if (message.length < LIMITS.messageMin || message.length > LIMITS.message) return "invalid_message";
  if (HTML.test(message)) return "html_not_allowed";
  return null;
}
