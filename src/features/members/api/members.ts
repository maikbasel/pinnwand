import { z } from "zod";
import { supabase } from "@/shared/lib/supabase";
import type { BoardMember } from "../types";

export const MEMBER_KEYS = {
  all: ["board-members"] as const,
  byBoard: (boardId: string) => ["board-members", "byBoard", boardId] as const,
};

const MemberRowSchema = z.object({
  user_id: z.uuid(),
  role: z.enum(["owner", "member"]),
  profiles: z.object({ display_name: z.string() }).nullable(),
});

export async function listBoardMembers(
  boardId: string
): Promise<BoardMember[]> {
  const { data, error } = await supabase
    .from("board_members")
    .select("user_id, role, profiles(display_name)")
    .eq("board_id", boardId)
    .order("role", { ascending: true });
  if (error) {
    throw error;
  }
  return z
    .array(MemberRowSchema)
    .parse(data)
    .map((row) => ({
      userId: row.user_id,
      role: row.role,
      displayName: row.profiles?.display_name ?? "",
    }));
}
