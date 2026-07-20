import { NOTE_TITLE_MAX } from "../api/notes";

export const UNTITLED_NOTE = "Unbenannte Notiz";

/**
 * Derives the notes-list label from the document's first non-empty line.
 *
 * This is a client-written cache on public.notes rather than something the
 * database computes, because the document is a CRDT blob that Postgres cannot
 * decode without an extension.
 */
export function deriveTitle(text: string): string {
  for (const line of text.split("\n")) {
    const collapsed = line.replace(/\s+/g, " ").trim();
    if (collapsed.length > 0) {
      return collapsed.slice(0, NOTE_TITLE_MAX);
    }
  }
  return UNTITLED_NOTE;
}
