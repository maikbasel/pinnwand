import { useSession } from "@/features/auth";

const FALLBACK_INITIAL = "?";
const MAX_INITIALS = 2;

/** Up to two uppercased letters from an email local-part, for the avatar chip. */
export function initialsForEmail(value: string | null): string {
  const local = value?.split("@")[0]?.trim() ?? "";
  const letters = local.replace(/[^a-zA-Z]/g, "");
  if (letters.length === 0) {
    return FALLBACK_INITIAL;
  }
  return letters.slice(0, MAX_INITIALS).toUpperCase();
}

type AccountIdentity = {
  identityId: string;
  identityName: string;
  identityEmail: string | null;
  identityInitials: string;
};

export function useAccountIdentity(): AccountIdentity {
  const { user } = useSession();
  const email = user?.email ?? null;
  const identityName = email?.split("@")[0] ?? "";
  return {
    identityId: user?.id ?? "",
    identityName,
    identityEmail: email,
    identityInitials: initialsForEmail(email),
  };
}
