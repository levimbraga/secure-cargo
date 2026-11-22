/**
 * Whether this browser was signed in (an account or a demo) the last time a page under /app knew.
 * Only a hint for the header's first frame, never for access: the API decides who sees what.
 */
const KEY = "sc:signed-in";

export function readSessionHint(): boolean | null {
  try {
    const value = window.localStorage.getItem(KEY);
    return value === null ? null : value === "1";
  } catch {
    return null;
  }
}

export function writeSessionHint(signedIn: boolean): void {
  try {
    window.localStorage.setItem(KEY, signedIn ? "1" : "0");
  } catch {
    // Private mode or storage blocked: the header just starts neutral.
  }
}
