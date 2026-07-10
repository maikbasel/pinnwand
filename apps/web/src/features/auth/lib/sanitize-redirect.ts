// Accept same-origin absolute paths only; reject anything that could leave the
// origin (javascript:, data:, //evil.example). Auth-route loop-back is not
// blocked here; requireGuest is the authority on who can be where.
const FORBIDDEN_SUBSTRINGS = ["//", ":"];

export function sanitizeRedirect(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    return "/";
  }
  if (!value.startsWith("/")) {
    return "/";
  }
  for (const forbidden of FORBIDDEN_SUBSTRINGS) {
    if (value.includes(forbidden)) {
      return "/";
    }
  }
  return value;
}
