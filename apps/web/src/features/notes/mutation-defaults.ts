import type { QueryClient } from "@tanstack/react-query";
import { appendNoteUpdate, NOTE_MUTATION_KEYS } from "./api/notes";

/**
 * A note write that was paused offline and rehydrated in a later session. Only
 * the document append is durable: creating and deleting notes needs the server
 * and runs network-only.
 */
export type ResumableNoteMutation = {
  op: "appendUpdate";
  noteId: string;
  update: Uint8Array<ArrayBuffer>;
};

async function runResumableNoteMutation(
  vars: ResumableNoteMutation
): Promise<void> {
  switch (vars.op) {
    case "appendUpdate":
      await appendNoteUpdate({ noteId: vars.noteId, update: vars.update });
      return;
    default: {
      const unreachable: never = vars.op;
      throw new Error(
        `Unknown resumable note mutation: ${JSON.stringify(unreachable)}`
      );
    }
  }
}

/**
 * Registers the resumable mutationFn for note document appends under the
 * generic ["notes", "mutate"] prefix. A mutation paused in a prior offline
 * session rehydrates with only its serialized variables, so no React hook
 * survives to supply a mutationFn. Call once from main.tsx before the persister
 * resumes paused mutations.
 */
export function registerNoteMutationDefaults(queryClient: QueryClient): void {
  queryClient.setMutationDefaults<void, Error, ResumableNoteMutation>(
    NOTE_MUTATION_KEYS.root,
    { mutationFn: (variables) => runResumableNoteMutation(variables) }
  );
}
