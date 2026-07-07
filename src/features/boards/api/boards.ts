import { z } from "zod";
import { supabase } from "@/shared/lib/supabase";
import type { Board, BoardMembership } from "../types";

export const BOARD_KEYS = {
  all: ["boards"] as const,
  byUser: (userId: string) => [...BOARD_KEYS.all, "byUser", userId] as const,
  joinPreviewByCode: (code: string) =>
    [...BOARD_KEYS.all, "joinPreviewByCode", code] as const,
};

export const BOARD_MUTATION_KEYS = {
  forBoard: (boardId: string) => ["board", boardId] as const,
};

const BoardRowSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  join_code: z.string(),
  created_by: z.uuid().nullable(),
  created_at: z.string(),
});

function toBoard(row: z.infer<typeof BoardRowSchema>): Board {
  return {
    id: row.id,
    name: row.name,
    joinCode: row.join_code,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

const MembershipRowSchema = z.object({
  role: z.enum(["owner", "member"]),
  boards: BoardRowSchema,
});

export async function listMyBoards(userId: string): Promise<BoardMembership[]> {
  // board_members RLS already scopes rows to boards the caller is a member
  // of, but a co-member's rows on a shared board pass that same policy — an
  // unfiltered select would return one row per member of every shared board,
  // not one row per board the caller belongs to. Filtering by user_id keeps
  // this to "my memberships".
  const { data, error } = await supabase
    .from("board_members")
    .select("role, boards!inner(id,name,join_code,created_by,created_at)")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) {
    throw error;
  }
  const rows = z.array(MembershipRowSchema).parse(data);
  return rows.map((row) => ({ board: toBoard(row.boards), role: row.role }));
}

const CreateBoardInput = z.object({ name: z.string().trim().min(1).max(80) });

export async function createBoard(input: { name: string }): Promise<Board> {
  const parsed = CreateBoardInput.parse(input);
  const { data, error } = await supabase.rpc("create_board", {
    p_name: parsed.name,
  });
  if (error) {
    throw error;
  }
  return toBoard(BoardRowSchema.parse(data));
}

const JoinBoardInput = z.object({
  // Share codes are copy/pasted and often re-typed with stray spacing or
  // dashes; normalize before hitting the RPC so "ab12-cd34" and "AB12CD34"
  // both resolve.
  code: z
    .string()
    .transform((value) => value.replace(/[\s-]+/g, "").toUpperCase())
    .pipe(z.string().min(1)),
});

export async function joinBoardByCode(input: { code: string }): Promise<Board> {
  const parsed = JoinBoardInput.parse(input);
  const { data, error } = await supabase.rpc("join_board_by_code", {
    p_code: parsed.code,
  });
  if (error) {
    throw error;
  }
  return toBoard(BoardRowSchema.parse(data));
}

const RenameBoardInput = z.object({
  boardId: z.uuid(),
  name: z.string().trim().min(1).max(80),
});

export async function renameBoard(input: {
  boardId: string;
  name: string;
}): Promise<Board> {
  const parsed = RenameBoardInput.parse(input);
  const { data, error } = await supabase
    .from("boards")
    .update({ name: parsed.name })
    .eq("id", parsed.boardId)
    .select()
    .single();
  if (error) {
    throw error;
  }
  return toBoard(BoardRowSchema.parse(data));
}

const DeleteBoardInput = z.object({ boardId: z.uuid() });

export async function deleteBoard(input: { boardId: string }): Promise<void> {
  const parsed = DeleteBoardInput.parse(input);
  const { error } = await supabase
    .from("boards")
    .delete()
    .eq("id", parsed.boardId);
  if (error) {
    throw error;
  }
}

const RegenerateJoinCodeInput = z.object({ boardId: z.uuid() });

export async function regenerateJoinCode(input: {
  boardId: string;
}): Promise<string> {
  const parsed = RegenerateJoinCodeInput.parse(input);
  const { data, error } = await supabase.rpc("regenerate_join_code", {
    p_board: parsed.boardId,
  });
  if (error) {
    throw error;
  }
  return z.string().parse(data);
}

const LeaveBoardInput = z.object({ boardId: z.uuid(), userId: z.uuid() });

export async function leaveBoard(input: {
  boardId: string;
  userId: string;
}): Promise<void> {
  const parsed = LeaveBoardInput.parse(input);
  const { error } = await supabase
    .from("board_members")
    .delete()
    .eq("board_id", parsed.boardId)
    .eq("user_id", parsed.userId);
  if (error) {
    throw error;
  }
}
