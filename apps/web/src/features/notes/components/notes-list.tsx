import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/shared/components/ui/button";
import { useBoardNotes } from "../hooks/use-board-notes";
import { useCreateNote } from "../hooks/use-create-note";
import { useDeleteNote } from "../hooks/use-delete-note";
import { useNotesRealtime } from "../hooks/use-notes-realtime";
import { NoteEditor } from "./note-editor";

type NotesPanelProps = {
  boardId: string;
  userName: string;
  userColor: string;
};

export function NotesPanel({ boardId, userName, userColor }: NotesPanelProps) {
  const { notes, isPending, isError } = useBoardNotes(boardId);
  const { createNote, isPending: isCreating } = useCreateNote(boardId);
  const { deleteNote } = useDeleteNote(boardId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useNotesRealtime(boardId);

  const selected = notes.find((note) => note.id === selectedId) ?? null;

  if (isError) {
    return (
      <p className="px-4 py-6 text-muted-foreground text-sm">
        Notizen konnten nicht geladen werden. Prüfe deine Verbindung.
      </p>
    );
  }

  if (isPending) {
    return (
      <p className="px-4 py-6 text-muted-foreground text-sm">
        Notizen werden geladen…
      </p>
    );
  }

  // Mobile: the list is a full screen and selecting a note replaces it.
  // Desktop: both are visible side by side.
  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <aside
        className={`${selected ? "hidden md:flex" : "flex"} min-h-0 w-full flex-col border-r md:w-72`}
      >
        <div className="flex items-center justify-between px-3 py-2">
          <h2 className="font-medium text-sm">Notizen</h2>
          <Button
            aria-label="Notiz erstellen"
            disabled={isCreating}
            onClick={async () => {
              const note = await createNote();
              setSelectedId(note.id);
            }}
            size="icon"
            variant="ghost"
          >
            <Plus className="size-4" />
          </Button>
        </div>
        {notes.length === 0 ? (
          <div className="px-3 py-6 text-muted-foreground text-sm">
            <p>Noch keine Notizen.</p>
            <p className="mt-2">
              Tipp: Schreibe <code>## </code> am Zeilenanfang für eine
              Überschrift, <code>- </code> für eine Liste.
            </p>
          </div>
        ) : (
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {notes.map((note) => (
              <li className="flex items-center gap-1 px-1" key={note.id}>
                <Button
                  className="flex-1 justify-start truncate"
                  onClick={() => setSelectedId(note.id)}
                  variant={note.id === selectedId ? "secondary" : "ghost"}
                >
                  {note.title}
                </Button>
                <Button
                  aria-label={`${note.title} löschen`}
                  onClick={async () => {
                    if (note.id === selectedId) {
                      setSelectedId(null);
                    }
                    await deleteNote(note.id);
                  }}
                  size="icon"
                  variant="ghost"
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </aside>
      {selected ? (
        <section className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b px-3 py-2 md:hidden">
            <Button
              onClick={() => setSelectedId(null)}
              size="sm"
              variant="ghost"
            >
              Zurück
            </Button>
            <span className="truncate font-medium text-sm">
              {selected.title}
            </span>
          </div>
          <NoteEditor
            boardId={boardId}
            key={selected.id}
            noteId={selected.id}
            userColor={userColor}
            userName={userName}
          />
        </section>
      ) : (
        <section className="hidden flex-1 items-center justify-center md:flex">
          <p className="text-muted-foreground text-sm">
            Wähle links eine Notiz aus.
          </p>
        </section>
      )}
    </div>
  );
}
