import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MemberRowSchema } from "../../schemas";
import { toToolError } from "../errors";
import type { ToolContext } from "../server";

export function registerMemberTools(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    "list_board_members",
    {
      description:
        "List a board's members and their roles (for choosing assignees).",
      inputSchema: { boardId: z.uuid() },
    },
    async ({ boardId }) => {
      try {
        const { data, error } = await ctx.supabase
          .from("board_members")
          .select("user_id, role, profiles(display_name)")
          .eq("board_id", boardId)
          .order("role", { ascending: true });
        if (error) {
          return toToolError(error);
        }
        // A board the caller isn't a member of returns zero rows under RLS
        // with no error — that's a normal empty read (unlike a delete, there
        // is no "denied mutation" to report), so it returns an empty list.
        const members = z
          .array(MemberRowSchema)
          .parse(data ?? [])
          .map((row) => ({
            userId: row.user_id,
            role: row.role,
            displayName: row.profiles?.display_name ?? "",
          }));
        return {
          content: [{ type: "text", text: JSON.stringify(members) }],
        };
      } catch (err) {
        return toToolError(err);
      }
    }
  );
}
