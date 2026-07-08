import { Button } from "@/shared/components/ui/button";
import { useSignOut } from "../hooks/use-sign-out";
import { SIGN_OUT } from "../lib/copy";

export function SignOutButton() {
  const signOut = useSignOut();
  return (
    <Button
      disabled={signOut.isPending}
      onClick={() => signOut.mutate()}
      size="sm"
      type="button"
      variant="ghost"
    >
      {SIGN_OUT}
    </Button>
  );
}
