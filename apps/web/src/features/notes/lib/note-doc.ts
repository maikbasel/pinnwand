import { applyUpdate, type Doc, encodeStateAsUpdate, mergeUpdates } from "yjs";
import {
  appendNoteUpdate,
  compactNote,
  getNote,
  listNoteUpdates,
} from "../api/notes";
import type { Note, NoteUpdate } from "../types";
import { fromBase64, toExactArrayBuffer } from "./bytes";

/**
 * Log rows tolerated before a snapshot is written. This is Yjs's own
 * PREFERRED_TRIM_SIZE from y-indexeddb rather than an invented threshold.
 */
export const COMPACT_THRESHOLD = 500;

/** Debounce between local edits and one durable append. */
export const UPDATE_FLUSH_MS = 400;

/** Name of the y-indexeddb database mirroring one note's document. */
export function noteDocDatabaseName(noteId: string): string {
  return `note:${noteId}`;
}

export function applyUpdates(doc: Doc, updates: NoteUpdate[]): number {
  let highest = 0;
  for (const entry of updates) {
    applyUpdate(doc, entry.update);
    if (entry.id > highest) {
      highest = entry.id;
    }
  }
  return highest;
}

export function hydrateDoc(
  doc: Doc,
  note: Note,
  updates: NoteUpdate[]
): number {
  if (note.snapshotB64) {
    applyUpdate(doc, fromBase64(note.snapshotB64));
  }
  const highest = applyUpdates(doc, updates);
  return Math.max(highest, note.snapshotUpToId);
}

/**
 * Decides what a reconnecting client must fetch.
 *
 * The case that matters: the note was compacted while this client was away, so
 * its lastSeenId points at rows that no longer exist. Re-applying the snapshot
 * is a no-op in Yjs when it has already been seen, so this needs no further
 * cleverness.
 */
export function resyncPlan(input: {
  lastSeenId: number;
  snapshotUpToId: number;
}): { needsSnapshot: boolean; afterId: number } {
  // >= (not >) so a fresh client (lastSeenId 0, snapshotUpToId 0) also
  // hydrates from the snapshot instead of assuming it is already current.
  if (input.snapshotUpToId >= input.lastSeenId) {
    return { needsSnapshot: true, afterId: input.snapshotUpToId };
  }
  return { needsSnapshot: false, afterId: input.lastSeenId };
}

type NoteSyncOptions = {
  noteId: string;
  doc: Doc;
  onError: (error: Error) => void;
  /**
   * When provided, the durable append goes through this instead of a direct
   * appendNoteUpdate call. Callers wire this to a resumable TanStack mutation
   * so an offline edit is paused and auto-resumed on reconnect rather than
   * lost. Fire-and-forget by contract: flush() does not await it, since
   * TanStack (not this class) owns retry/durability for that path.
   */
  persist?: (update: Uint8Array<ArrayBuffer>) => void;
};

/**
 * Owns the durable half of note sync: hydration, the debounced append of local
 * updates, resync after a reconnect, and opportunistic compaction on close.
 *
 * Remote delivery is not this class's job. The caller subscribes to
 * postgres_changes and hands rows to applyRemote.
 */
export class NoteSync {
  private readonly noteId: string;
  private readonly doc: Doc;
  private readonly onError: (error: Error) => void;
  private readonly persist:
    | ((update: Uint8Array<ArrayBuffer>) => void)
    | undefined;
  private pending: Uint8Array[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSeenId = 0;
  private appendedSinceSnapshot = 0;
  private stopped = false;

  constructor(options: NoteSyncOptions) {
    this.noteId = options.noteId;
    this.doc = options.doc;
    this.onError = options.onError;
    this.persist = options.persist;
  }

  async start(): Promise<void> {
    const note = await getNote(this.noteId);
    const updates = await listNoteUpdates({
      noteId: this.noteId,
      afterId: note.snapshotUpToId,
    });
    this.lastSeenId = hydrateDoc(this.doc, note, updates);
    this.appendedSinceSnapshot = updates.length;
  }

  /** Re-fetches whatever this client missed while disconnected. */
  async resync(): Promise<void> {
    const note = await getNote(this.noteId);
    const plan = resyncPlan({
      lastSeenId: this.lastSeenId,
      snapshotUpToId: note.snapshotUpToId,
    });
    if (plan.needsSnapshot && note.snapshotB64) {
      applyUpdate(this.doc, fromBase64(note.snapshotB64));
    }
    const updates = await listNoteUpdates({
      noteId: this.noteId,
      afterId: plan.afterId,
    });
    this.lastSeenId = Math.max(
      this.lastSeenId,
      applyUpdates(this.doc, updates),
      note.snapshotUpToId
    );
  }

  applyRemote(entry: NoteUpdate): void {
    if (entry.id <= this.lastSeenId) {
      return;
    }
    applyUpdate(this.doc, entry.update);
    this.lastSeenId = entry.id;
    this.appendedSinceSnapshot += 1;
  }

  queueLocalUpdate(update: Uint8Array): void {
    if (this.stopped) {
      return;
    }
    this.pending.push(update);
    if (this.flushTimer !== null) {
      return;
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      // flush() catches its own errors and reports them via onError, so it
      // never rejects; this call is intentionally not awaited from a
      // non-async timer callback.
      this.flush();
    }, UPDATE_FLUSH_MS);
  }

  async flush(): Promise<void> {
    if (this.pending.length === 0) {
      return;
    }
    // One row per flush window, not one per keystroke.
    const merged = new Uint8Array(
      toExactArrayBuffer(mergeUpdates(this.pending))
    );
    this.pending = [];
    if (this.persist) {
      // Fire-and-forget: TanStack owns durability + offline pause/resume for
      // this path, so awaiting here would block flush/stop (and therefore
      // teardown) while offline.
      this.persist(merged);
      this.appendedSinceSnapshot += 1;
      return;
    }
    try {
      await appendNoteUpdate({ noteId: this.noteId, update: merged });
      this.appendedSinceSnapshot += 1;
    } catch (error) {
      // Re-queue so the failed append is retried on the next flush/stop rather
      // than being lost from the durable log.
      this.pending.unshift(merged);
      this.onError(
        error instanceof Error ? error : new Error("Speichern fehlgeschlagen")
      );
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
    // The lastSeenId > 0 guard keeps a fresh/never-hydrated NoteSync from
    // ever compacting with a bogus low id — compact_note is also guarded
    // server-side against moving snapshot_up_to_id backward, this is the
    // defensive client-side half of that invariant.
    if (this.appendedSinceSnapshot > COMPACT_THRESHOLD && this.lastSeenId > 0) {
      try {
        await compactNote({
          noteId: this.noteId,
          snapshot: new Uint8Array(
            toExactArrayBuffer(encodeStateAsUpdate(this.doc))
          ),
          upToId: this.lastSeenId,
        });
        this.appendedSinceSnapshot = 0;
      } catch (error) {
        // Compaction is opportunistic. A failure leaves a longer log, which is
        // a performance cost and not a correctness one, so it is reported but
        // does not surface as a user-facing save failure.
        this.onError(
          error instanceof Error ? error : new Error("Aufräumen fehlgeschlagen")
        );
      }
    }
  }
}
