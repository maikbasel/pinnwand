export type BoardRole = "owner" | "member";

export type Board = {
  id: string;
  name: string;
  joinCode: string;
  createdBy: string | null;
  createdAt: string;
};

export type BoardMembership = { board: Board; role: BoardRole };
