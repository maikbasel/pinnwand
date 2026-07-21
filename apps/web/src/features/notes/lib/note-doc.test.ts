import { afterEach, describe, expect, it, vi } from "vitest";
import { applyUpdate, Doc, encodeStateAsUpdate } from "yjs";
import { appendNoteUpdate } from "../api/notes";
import type { Note, NoteUpdate } from "../types";
import { toBase64 } from "./bytes";
import {
  applyUpdates,
  deliverableUpdateRow,
  hydrateDoc,
  NoteSync,
  resyncPlan,
} from "./note-doc";

vi.mock("../api/notes", () => ({
  appendNoteUpdate: vi.fn(),
}));

function docWithText(value: string): Doc {
  const doc = new Doc();
  doc.getText("t").insert(0, value);
  return doc;
}

function updatesFrom(doc: Doc, startId: number): NoteUpdate[] {
  return [{ id: startId, update: encodeStateAsUpdate(doc) }];
}

function emptyNote(overrides: Partial<Note> = {}): Note {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    boardId: "00000000-0000-0000-0000-000000000002",
    title: "",
    snapshotB64: null,
    snapshotUpToId: 0,
    createdBy: null,
    createdAt: "2026-07-19T00:00:00Z",
    updatedAt: "2026-07-19T00:00:00Z",
    ...overrides,
  };
}

describe("applyUpdates", () => {
  it("applies updates in order and returns the highest id", () => {
    const source = docWithText("hallo");
    const target = new Doc();
    const highest = applyUpdates(target, updatesFrom(source, 7));
    expect(target.getText("t").toString()).toBe("hallo");
    expect(highest).toBe(7);
  });

  it("returns 0 for an empty list", () => {
    expect(applyUpdates(new Doc(), [])).toBe(0);
  });

  it("is idempotent when the same update is applied twice", () => {
    const source = docWithText("abc");
    const target = new Doc();
    const updates = updatesFrom(source, 1);
    applyUpdates(target, updates);
    applyUpdates(target, updates);
    expect(target.getText("t").toString()).toBe("abc");
  });
});

describe("hydrateDoc", () => {
  it("applies the snapshot before the incremental updates", () => {
    const base = docWithText("eins");
    const note = emptyNote({
      snapshotB64: toBase64(encodeStateAsUpdate(base)),
      snapshotUpToId: 5,
    });
    const later = new Doc();
    applyUpdate(later, encodeStateAsUpdate(base));
    later.getText("t").insert(4, " zwei");

    const target = new Doc();
    const highest = hydrateDoc(target, note, [
      { id: 9, update: encodeStateAsUpdate(later) },
    ]);
    expect(target.getText("t").toString()).toBe("eins zwei");
    expect(highest).toBe(9);
  });

  it("falls back to snapshotUpToId when there are no updates", () => {
    const base = docWithText("nur snapshot");
    const note = emptyNote({
      snapshotB64: toBase64(encodeStateAsUpdate(base)),
      snapshotUpToId: 12,
    });
    const target = new Doc();
    expect(hydrateDoc(target, note, [])).toBe(12);
    expect(target.getText("t").toString()).toBe("nur snapshot");
  });
});

describe("resyncPlan", () => {
  it("asks for incremental updates when the client is current", () => {
    expect(resyncPlan({ lastSeenId: 40, snapshotUpToId: 10 })).toEqual({
      needsSnapshot: false,
      afterId: 40,
    });
  });

  it("asks for the snapshot when compaction outran the client", () => {
    // The client was offline while the note was compacted, so its lastSeenId
    // points at rows that have been deleted.
    expect(resyncPlan({ lastSeenId: 3, snapshotUpToId: 20 })).toEqual({
      needsSnapshot: true,
      afterId: 20,
    });
  });

  it("treats a fresh client as needing the snapshot", () => {
    expect(resyncPlan({ lastSeenId: 0, snapshotUpToId: 0 })).toEqual({
      needsSnapshot: true,
      afterId: 0,
    });
  });
});

describe("deliverableUpdateRow", () => {
  it("returns the row when the payload carries the update", () => {
    expect(
      deliverableUpdateRow({
        errors: null,
        new: { id: 7, update_b64: "AAECAw==" },
      })
    ).toEqual({ id: 7, update_b64: "AAECAw==" });
  });

  it("returns null when a large paste is truncated to an errors payload", () => {
    // Realtime drops the row's columns and sets errors when the record exceeds
    // its max payload size (~1MB) — the shape a big paste arrives in.
    expect(
      deliverableUpdateRow({
        errors: ["Error 413: Payload Too Large"],
        new: {},
      })
    ).toBeNull();
  });

  it("returns null when update_b64 is missing even without an errors array", () => {
    expect(deliverableUpdateRow({ errors: null, new: { id: 7 } })).toBeNull();
  });
});

describe("convergence", () => {
  it("converges regardless of the order updates are applied", () => {
    const a = new Doc();
    const b = new Doc();
    a.getText("t").insert(0, "links");
    b.getText("t").insert(0, "rechts");
    const updateA = encodeStateAsUpdate(a);
    const updateB = encodeStateAsUpdate(b);

    const forward = new Doc();
    applyUpdates(forward, [
      { id: 1, update: updateA },
      { id: 2, update: updateB },
    ]);

    const reverse = new Doc();
    applyUpdates(reverse, [
      { id: 2, update: updateB },
      { id: 1, update: updateA },
    ]);

    expect(forward.getText("t").toString()).toBe(
      reverse.getText("t").toString()
    );
  });

  it("converges across many randomised orderings", () => {
    const sources = Array.from({ length: 6 }, (_, i) => {
      const doc = new Doc();
      doc.getText("t").insert(0, `teil-${i} `);
      return { id: i + 1, update: encodeStateAsUpdate(doc) };
    });

    const canonical = new Doc();
    applyUpdates(canonical, sources);
    const expected = canonical.getText("t").toString();

    for (let trial = 0; trial < 25; trial += 1) {
      // Deterministic shuffle so a failure reproduces.
      const shuffled = [...sources].sort(
        (x, y) => ((x.id * 7 + trial) % 5) - ((y.id * 7 + trial) % 5)
      );
      const doc = new Doc();
      applyUpdates(doc, shuffled);
      expect(doc.getText("t").toString()).toBe(expected);
    }
  });
});

describe("NoteSync.flush", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("re-queues a failed append so the next flush retries it instead of losing it", async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const mockAppend = vi.mocked(appendNoteUpdate);
    mockAppend.mockRejectedValueOnce(new Error("network down"));

    const sync = new NoteSync({ noteId: "note-1", doc: new Doc(), onError });
    sync.queueLocalUpdate(encodeStateAsUpdate(docWithText("hallo")));

    // First flush: the append fails, so the merged update must be re-queued
    // rather than dropped.
    await sync.flush();
    expect(mockAppend).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);

    // Second flush: append now succeeds, and must be called with the same
    // buffered content that failed to send the first time.
    mockAppend.mockResolvedValueOnce(undefined);
    await sync.flush();
    expect(mockAppend).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);

    const retriedUpdate = mockAppend.mock.calls[1]?.[0]?.update;
    expect(retriedUpdate).toBeInstanceOf(Uint8Array);
    const target = new Doc();
    if (retriedUpdate) {
      applyUpdate(target, retriedUpdate);
    }
    expect(target.getText("t").toString()).toBe("hallo");
  });

  it("routes the durable append through persist when provided, instead of appendNoteUpdate", async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const persist = vi.fn();
    const mockAppend = vi.mocked(appendNoteUpdate);

    const sync = new NoteSync({
      noteId: "note-1",
      doc: new Doc(),
      onError,
      persist,
    });
    sync.queueLocalUpdate(encodeStateAsUpdate(docWithText("hallo")));

    await sync.flush();

    expect(persist).toHaveBeenCalledTimes(1);
    expect(mockAppend).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();

    const persisted = persist.mock.calls[0]?.[0];
    expect(persisted).toBeInstanceOf(Uint8Array);
    const target = new Doc();
    if (persisted) {
      applyUpdate(target, persisted);
    }
    expect(target.getText("t").toString()).toBe("hallo");
  });
});
