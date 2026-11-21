import { describe, expect, it } from "vitest";

import en from "@/messages/en.json";
import pt from "@/messages/pt-BR.json";

import { AUTH_ERROR_KEYS, authErrorKey, clerkErrorCode, localAuthError } from "./auth-errors";

describe("auth errors", () => {
  it("reads the first code of a Clerk API error", () => {
    const error = { code: "api_response_error", errors: [{ code: "form_password_incorrect" }] };
    expect(clerkErrorCode(error)).toBe("form_password_incorrect");
    expect(authErrorKey(error)).toBe("wrong_password");
  });

  it("maps the common sign-in, sign-up and reset failures", () => {
    const key = (code: string) => authErrorKey({ errors: [{ code }] });
    expect(key("form_identifier_not_found")).toBe("no_account");
    expect(key("form_identifier_exists")).toBe("account_exists");
    expect(key("form_password_pwned")).toBe("weak_password");
    expect(key("form_code_incorrect")).toBe("wrong_code");
    expect(key("verification_expired")).toBe("code_expired");
    expect(key("too_many_requests")).toBe("too_many");
  });

  it("falls back to a generic sentence for anything unknown", () => {
    expect(authErrorKey({ errors: [{ code: "something_new" }] })).toBe("failed");
    expect(authErrorKey(new Error("network"))).toBe("failed");
    expect(authErrorKey(null)).toBe("failed");
  });

  it("checks the email and the password length before any request", () => {
    expect(localAuthError("not-an-email", "longenough")).toBe("invalid_email");
    expect(localAuthError("driver@example.com", "short")).toBe("short_password");
    expect(localAuthError("driver@example.com", "longenough")).toBeNull();
    expect(localAuthError("driver@example.com")).toBeNull();
  });

  it("has a sentence for every key in both languages", () => {
    for (const messages of [en, pt]) {
      const errors = (messages.Auth.form.errors ?? {}) as Record<string, string>;
      for (const key of AUTH_ERROR_KEYS) expect(errors[key], key).toBeTruthy();
    }
  });
});
