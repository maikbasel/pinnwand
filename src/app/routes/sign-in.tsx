import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireGuest, SignInForm, sanitizeRedirect } from "@/features/auth";
import { PinnwandLogo } from "@/shared/components/pinnwand-logo";

const SearchSchema = z.object({ redirect: z.string().optional() });

export const Route = createFileRoute("/sign-in")({
  validateSearch: SearchSchema,
  beforeLoad: requireGuest,
  component: SignIn,
});

function SignIn() {
  const { redirect } = Route.useSearch();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
      <PinnwandLogo className="rounded-2xl shadow-sm" size={56} />
      <SignInForm redirect={sanitizeRedirect(redirect)} />
    </div>
  );
}
