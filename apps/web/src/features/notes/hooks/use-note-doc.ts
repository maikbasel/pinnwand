import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { IndexeddbPersistence } from "y-indexeddb";
import { Awareness } from "y-protocols/awareness";
import { Doc, transact } from "yjs";
import { noop } from "@/shared/lib/noop";
import { supabase } from "@/shared/lib/supabase";
import { NOTE_MUTATION_KEYS } from "../api/notes";
import { connectAwareness } from "../lib/awareness-channel";
import { fromBase64 } from "../lib/bytes";
import { NoteSync } from "../lib/note-doc";
import type { ResumableNoteMutation } from "../mutation-defaults";

export type NoteDocStatus = "loading" | "ready" | "error";

export type NoteDocHandle = {
  doc: Doc;
  awareness: Awareness;
  status: NoteDocStatus;
};

/**
 * Owns one note's CRDT session: the Y.Doc, its IndexedDB mirror, the durable
 * append log, the postgres_changes subscription, and the awareness channel.
 *
 * Two persistence layers with distinct jobs. The TanStack persister holds the
 * notes list (and, via the resumable "notes"/"mutate" mutation, the durable
 * append log); y-indexeddb holds the document so a cold offline launch has
 * content.
 */
export function useNoteDoc(noteId: string, boardId: string): NoteDocHandle {
  const [handle, setHandle] = useState<NoteDocHandle | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!noteId) {
      return;
    }
    const doc = new Doc();
    const awareness = new Awareness(doc);
    const persistence = new IndexeddbPersistence(`note:${noteId}`, doc);
    setHandle({ doc, awareness, status: "loading" });

    const onError = (error: Error): void => {
      toast.error(error.message);
    };

    // Dispatches the durable append as a resumable TanStack mutation instead
    // of calling the API directly, so an offline edit is paused and replayed
    // on reconnect. Fire-and-forget: TanStack owns durability/retry for this
    // path, and errors surface through the global mutationCache onError.
    const persist = (update: Uint8Array<ArrayBuffer>): void => {
      queryClient
        .getMutationCache()
        .build<void, Error, ResumableNoteMutation, unknown>(queryClient, {
          mutationKey: NOTE_MUTATION_KEYS.forBoard(boardId),
        })
        .execute({ op: "appendUpdate", noteId, update })
        .then(noop, noop);
    };

    const sync = new NoteSync({ noteId, doc, onError, persist });
    let disposed = false;

    const onLocalUpdate = (update: Uint8Array, origin: unknown): void => {
      // Remote-applied updates must not be re-appended to the log.
      if (origin === "remote") {
        return;
      }
      sync.queueLocalUpdate(update);
    };

    const channel = supabase
      .channel(`note:${noteId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "note_updates",
          filter: `note_id=eq.${noteId}`,
        },
        (message) => {
          const row = message.new as { id: number; update_b64: string };
          transact(
            doc,
            () =>
              sync.applyRemote({
                id: row.id,
                update: fromBase64(row.update_b64),
              }),
            "remote"
          );
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED" && !disposed) {
          sync.resync().catch(onError);
        }
      });

    const disconnectAwareness = connectAwareness({
      noteId,
      awareness,
      onError,
    });

    sync
      .start()
      .then(() => {
        if (disposed) {
          return;
        }
        doc.on("update", onLocalUpdate);
        setHandle({ doc, awareness, status: "ready" });
      })
      .catch((error: unknown) => {
        if (disposed) {
          return;
        }
        onError(
          error instanceof Error
            ? error
            : new Error("Notiz konnte nicht geladen werden")
        );
        setHandle({ doc, awareness, status: "error" });
      });

    return () => {
      disposed = true;
      doc.off("update", onLocalUpdate);
      disconnectAwareness();
      supabase.removeChannel(channel).then(noop, noop);
      sync.stop().finally(() => {
        awareness.destroy();
        persistence.destroy().then(noop, noop);
        doc.destroy();
      });
    };
  }, [noteId, boardId, queryClient]);

  if (handle) {
    return handle;
  }
  // Stable placeholder for the first render before the effect runs.
  const doc = new Doc();
  return { doc, awareness: new Awareness(doc), status: "loading" };
}
