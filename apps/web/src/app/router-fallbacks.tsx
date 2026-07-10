import { Loader2 } from "lucide-react";

export function RouterPending() {
  return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}

export function RouterError({ error }: { error: Error }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <div>
        <p className="font-medium">Etwas ist schiefgelaufen.</p>
        <p className="mt-1 text-muted-foreground text-sm">{error.message}</p>
      </div>
      <button
        className="rounded-md bg-primary px-4 py-2 text-primary-foreground text-sm"
        onClick={() => window.location.reload()}
        type="button"
      >
        Neu laden
      </button>
    </div>
  );
}
