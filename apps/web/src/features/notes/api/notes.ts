import { z } from "zod";
import { supabase } from "@/shared/lib/supabase";
import { fromBase64, toBase64 } from "../lib/bytes";
import type { Note, NoteUpdate } from "../types";

export const NOTE_KEYS = {
  all: ["notes"] as const,
  byBoard: (boardId: string) => ["notes", "byBoard", boardId] as const,
  doc: (noteId: string) => ["notes", "doc", noteId] as const,
};

export const NOTE_MUTATION_KEYS = {
  // The generic prefix the offline resumable defaults register under; a paused
  // write's per-board key prefix-matches it on replay.
  root: ["notes", "mutate"] as const,
  forBoard: (boardId: string) => ["notes", "mutate", boardId] as const,
};

export const NOTE_TITLE_MAX = 200;

const NoteRowSchema = z.object({
  id: z.uuid(),
  board_id: z.uuid(),
  title: z.string(),
  snapshot_b64: z.string().nullable(),
  snapshot_up_to_id: z.coerce.number(),
  created_by: z.uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const NOTE_SELECT =
  "id,board_id,title,snapshot_b64,snapshot_up_to_id,created_by,created_at,updated_at";

function toNote(row: z.infer<typeof NoteRowSchema>): Note {
  return {
    id: row.id,
    boardId: row.board_id,
    title: row.title,
    snapshotB64: row.snapshot_b64,
    snapshotUpToId: row.snapshot_up_to_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listBoardNotes(boardId: string): Promise<Note[]> {
  const { data, error } = await supabase
    .from("notes")
    .select(NOTE_SELECT)
    .eq("board_id", boardId)
    .order("updated_at", { ascending: false })
    .order("id", { ascending: true });
  if (error) {
    throw error;
  }
  return z.array(NoteRowSchema).parse(data).map(toNote);
}

export async function getNote(noteId: string): Promise<Note> {
  const { data, error } = await supabase
    .from("notes")
    .select(NOTE_SELECT)
    .eq("id", noteId)
    .single();
  if (error) {
    throw error;
  }
  return toNote(NoteRowSchema.parse(data));
}

const CreateNoteInput = z.object({
  boardId: z.uuid(),
  title: z.string().trim().max(NOTE_TITLE_MAX),
});

export async function createNote(
  input: z.input<typeof CreateNoteInput>
): Promise<Note> {
  const parsed = CreateNoteInput.parse(input);
  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("notes")
    .insert({
      board_id: parsed.boardId,
      title: parsed.title,
      created_by: auth.user?.id ?? null,
    })
    .select(NOTE_SELECT)
    .single();
  if (error) {
    throw error;
  }
  return toNote(NoteRowSchema.parse(data));
}

export async function deleteNote(noteId: string): Promise<void> {
  const { error } = await supabase.from("notes").delete().eq("id", noteId);
  if (error) {
    throw error;
  }
}

const SetNoteTitleInput = z.object({
  noteId: z.uuid(),
  title: z.string().trim().max(NOTE_TITLE_MAX),
});

export async function setNoteTitle(
  input: z.input<typeof SetNoteTitleInput>
): Promise<void> {
  const parsed = SetNoteTitleInput.parse(input);
  const { error } = await supabase
    .from("notes")
    .update({ title: parsed.title })
    .eq("id", parsed.noteId);
  if (error) {
    throw error;
  }
}

const NoteUpdateRowSchema = z.object({
  id: z.coerce.number(),
  update_b64: z.string(),
});

const ListNoteUpdatesInput = z.object({
  noteId: z.uuid(),
  afterId: z.number().int().nonnegative(),
});

export async function listNoteUpdates(
  input: z.input<typeof ListNoteUpdatesInput>
): Promise<NoteUpdate[]> {
  const parsed = ListNoteUpdatesInput.parse(input);
  const { data, error } = await supabase
    .from("note_updates")
    .select("id,update_b64")
    .eq("note_id", parsed.noteId)
    .gt("id", parsed.afterId)
    .order("id", { ascending: true });
  if (error) {
    throw error;
  }
  return z
    .array(NoteUpdateRowSchema)
    .parse(data)
    .map((row) => ({ id: row.id, update: fromBase64(row.update_b64) }));
}

const AppendNoteUpdateInput = z.object({
  noteId: z.uuid(),
  update: z.instanceof(Uint8Array),
});

export async function appendNoteUpdate(
  input: z.input<typeof AppendNoteUpdateInput>
): Promise<void> {
  const parsed = AppendNoteUpdateInput.parse(input);
  const { error } = await supabase.from("note_updates").insert({
    note_id: parsed.noteId,
    update_b64: toBase64(parsed.update),
  });
  if (error) {
    throw error;
  }
}

const CompactNoteInput = z.object({
  noteId: z.uuid(),
  snapshot: z.instanceof(Uint8Array),
  upToId: z.number().int().nonnegative(),
});

export async function compactNote(
  input: z.input<typeof CompactNoteInput>
): Promise<void> {
  const parsed = CompactNoteInput.parse(input);
  const { error } = await supabase.rpc("compact_note", {
    p_note_id: parsed.noteId,
    p_snapshot_b64: toBase64(parsed.snapshot),
    p_up_to_id: parsed.upToId,
  });
  if (error) {
    throw error;
  }
}
