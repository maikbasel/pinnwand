import { ChevronsUpDownIcon, LogOutIcon } from "lucide-react";
import { useSignOut } from "@/features/auth";
import { Avatar, AvatarFallback } from "@/shared/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { useAccountIdentity } from "../lib/account-identity";
import {
  ACCOUNT_LABEL,
  SIGN_OUT_LABEL,
  SIGN_OUT_PENDING_LABEL,
} from "../lib/copy";

type Props = {
  /** Avatar-only trigger for the mobile top bar. The desktop rail uses the
   * full identity trigger (avatar + name + email + chevron). */
  compact?: boolean;
};

const FULL_TRIGGER_CLASSNAME =
  "flex w-full items-center gap-2.5 rounded-xl border border-border bg-background px-2.5 py-2 text-left transition hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2";

const COMPACT_TRIGGER_CLASSNAME =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-full transition hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2";

/**
 * The account control shared by the desktop rail and the mobile top bar.
 * Shows the signed-in identity and opens a dropdown menu whose only item is
 * Abmelden (sign out). Profil and Einstellungen join once those slices ship
 * real routes; a menu item to a nonexistent route is a placeholder, which is
 * forbidden here.
 */
export function AccountMenu({ compact = false }: Props) {
  const { identityName, identityInitials, identityEmail } =
    useAccountIdentity();
  const signOut = useSignOut();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={ACCOUNT_LABEL}
        className={compact ? COMPACT_TRIGGER_CLASSNAME : FULL_TRIGGER_CLASSNAME}
        data-testid="account-menu-trigger"
      >
        <Avatar className="size-8">
          <AvatarFallback className="bg-primary font-semibold text-primary-foreground ring-0">
            {identityInitials}
          </AvatarFallback>
        </Avatar>
        {compact ? null : (
          <>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-medium text-foreground text-sm leading-tight">
                {identityName}
              </span>
              {identityEmail ? (
                <span
                  className="truncate text-muted-foreground text-xs"
                  data-testid="account-menu-email"
                >
                  {identityEmail}
                </span>
              ) : null}
            </span>
            <ChevronsUpDownIcon
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground"
            />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-60"
        side={compact ? "bottom" : "top"}
        sideOffset={8}
      >
        <DropdownMenuItem
          data-testid="account-signout"
          disabled={signOut.isPending}
          onClick={() => signOut.mutate()}
        >
          <LogOutIcon aria-hidden="true" className="text-muted-foreground" />
          <span>
            {signOut.isPending ? SIGN_OUT_PENDING_LABEL : SIGN_OUT_LABEL}
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
