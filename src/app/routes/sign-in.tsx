import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/sign-in")({
  component: SignIn,
});

// Placeholder sign-in. Magic-link + 6-digit OTP (input-otp) lands with the
// `auth` feature slice, mirroring Mahlzeit's passwordless flow.
function SignIn() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
      <div className="text-center">
        <h1 className="font-semibold text-2xl tracking-tight">Pinnwand</h1>
        <p className="mt-1 text-muted-foreground text-sm">
          Melde dich mit deiner E-Mail an.
        </p>
      </div>
      <form className="flex w-full max-w-sm flex-col gap-3">
        <input
          className="rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          disabled
          placeholder="du@beispiel.de"
          type="email"
        />
        <button
          className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm disabled:opacity-60"
          disabled
          type="submit"
        >
          Magic-Link senden
        </button>
      </form>
    </div>
  );
}
