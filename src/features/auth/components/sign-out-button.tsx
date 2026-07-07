import { useSignOut } from "../hooks/use-sign-out";
import { SIGN_OUT } from "../lib/copy";

export function SignOutButton() {
  const signOut = useSignOut();
  return (
    <button
      className="rounded-md px-3 py-2 font-medium text-muted-foreground text-sm hover:text-foreground disabled:opacity-60"
      disabled={signOut.isPending}
      onClick={() => signOut.mutate()}
      type="button"
    >
      {SIGN_OUT}
    </button>
  );
}
