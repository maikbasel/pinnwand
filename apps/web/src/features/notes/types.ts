export type Note = {
  id: string;
  boardId: string;
  title: string;
  snapshotB64: string | null;
  snapshotUpToId: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NoteUpdate = {
  id: number;
  update: Uint8Array;
};
