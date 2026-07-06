import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";

export const Route = createFileRoute("/")({
  component: BoardsIndex,
});

// Placeholder boards list. The real list (owned + shared boards, create dialog,
// join-by-code) lands with the `boards` feature slice.
function BoardsIndex() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-4">
      <header className="flex items-center justify-between">
        <h1 className="font-semibold text-2xl tracking-tight">Pinnwand</h1>
        <button
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground text-sm shadow-sm"
          type="button"
        >
          <Plus className="size-4" />
          Neues Board
        </button>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Link
          className="rounded-lg border bg-card p-4 shadow-sm transition-colors hover:border-primary/40"
          params={{ boardId: "demo" }}
          to="/boards/$boardId"
        >
          <p className="font-medium">Demo-Board</p>
          <p className="mt-1 text-muted-foreground text-sm">
            Beispiel — öffnen, um die vier Spalten zu sehen.
          </p>
        </Link>
      </div>
    </div>
  );
}
