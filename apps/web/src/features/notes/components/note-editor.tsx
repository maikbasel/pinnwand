import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect } from "react";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { useNoteDoc } from "../hooks/use-note-doc";
import { useSetNoteTitle } from "../hooks/use-set-note-title";
import { deriveTitle } from "../lib/title";
import { FormatBar } from "./format-bar";

type NoteEditorProps = {
  boardId: string;
  noteId: string;
  userName: string;
  userColor: string;
};

export function NoteEditor({
  boardId,
  noteId,
  userName,
  userColor,
}: NoteEditorProps) {
  const { doc, awareness, status } = useNoteDoc(noteId, boardId);
  const scheduleTitleUpdate = useSetNoteTitle(noteId, boardId);

  const editor = useEditor(
    {
      extensions: [
        // History is owned by the Yjs UndoManager, so StarterKit's must go.
        StarterKit.configure({ undoRedo: false }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Collaboration.configure({ document: doc }),
        CollaborationCaret.configure({
          provider: { awareness },
          user: { name: userName, color: userColor },
        }),
      ],
      editorProps: {
        attributes: {
          class:
            "prose prose-sm dark:prose-invert max-w-none px-4 py-3 focus:outline-none min-h-[50vh]",
          "aria-label": "Notiz bearbeiten",
        },
      },
      immediatelyRender: false,
    },
    [doc, awareness, userName, userColor]
  );

  useEffect(() => {
    if (!editor) {
      return;
    }
    const onUpdate = (): void => {
      scheduleTitleUpdate(deriveTitle(editor.getText()));
    };
    editor.on("update", onUpdate);
    return () => {
      editor.off("update", onUpdate);
    };
  }, [editor, scheduleTitleUpdate]);

  if (status === "error") {
    return (
      <p className="px-4 py-6 text-muted-foreground text-sm">
        Diese Notiz konnte nicht geladen werden. Prüfe deine Verbindung.
      </p>
    );
  }

  if (status === "loading") {
    // The editor view is deliberately not mounted while hydrating. The local
    // update listener is only attached once the durable log has been replayed,
    // so anything typed before that would live in the Y.Doc without ever
    // reaching note_updates — invisible to every other member.
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-3">
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <FormatBar editor={editor} />
      <EditorContent
        // Mobile pb-14 reserves space for the fixed toolbar (~44px) docked
        // above the keyboard, so it never covers the last line. Desktop keeps
        // the bar in flow above the content, so no reservation is needed.
        className="min-h-0 flex-1 overflow-y-auto pb-14 md:pb-0"
        editor={editor}
      />
    </div>
  );
}
