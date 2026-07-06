// biome-ignore-all lint/style/useFilenamingConvention: TanStack Router file-based route param uses `$boardId` per https://tanstack.com/router/latest/docs/framework/react/routing/dynamic-route-segments
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { TASK_COLUMNS } from "@/features/tasks/columns";

export const Route = createFileRoute("/boards/$boardId")({
  component: BoardView,
});

// Placeholder board. Renders the four fixed columns statically so the shell is
// visible; cards, drag-and-drop (dnd-kit), assignees and realtime land with the
// `tasks` feature slice.
function BoardView() {
  const { boardId } = Route.useParams();

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center gap-3 border-b p-4">
        <Link
          aria-label="Zurück"
          className="rounded-md p-1.5 hover:bg-muted"
          to="/"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="font-semibold text-lg tracking-tight">
          Board {boardId}
        </h1>
      </header>

      <div className="flex flex-1 gap-3 overflow-x-auto p-4 [scroll-snap-type:x_mandatory]">
        {TASK_COLUMNS.map((column) => (
          <section
            className="flex w-72 shrink-0 flex-col rounded-lg bg-muted/50 [scroll-snap-align:start]"
            key={column.id}
          >
            <h2 className="px-3 py-2.5 font-medium text-muted-foreground text-sm">
              {column.label}
            </h2>
            <div className="flex-1 px-2 pb-2">
              <p className="rounded-md border border-dashed p-3 text-center text-muted-foreground text-xs">
                Noch keine Aufgaben
              </p>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
