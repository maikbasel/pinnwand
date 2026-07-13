import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TASK_COLUMNS } from "@pinnwand/contracts";
import { z } from "zod";
import { BoardRowSchema, TaskColumnSchema } from "../../schemas";
import { toToolError } from "../errors";
import type { ToolContext } from "../server";

const boardIdInput = { boardId: z.uuid() };

// Membership row returned by list_boards: board_members joined to its board.
const BoardMembershipRowSchema = z.object({
  role: z.enum(["owner", "member"]),
  boards: BoardRowSchema,
});

const TaskColumnCountRowSchema = z.array(
  z.object({ column: TaskColumnSchema })
);

type TaskColumnId = (typeof TASK_COLUMNS)[number]["id"];

function countTasksByColumn(rows: { column: TaskColumnId }[]) {
  const counts = Object.fromEntries(
    TASK_COLUMNS.map((c) => [c.id, 0])
  ) as Record<TaskColumnId, number>;
  for (const row of rows) {
    counts[row.column] += 1;
  }
  return counts;
}

export function registerBoardTools(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    "list_boards",
    {
      description:
        "List the boards the current user is a member of, with their role on each.",
      inputSchema: {},
    },
    async () => {
      try {
        const { data, error } = await ctx.supabase
          .from("board_members")
          .select("role, boards(*)")
          .eq("user_id", ctx.userId);
        if (error) {
          return toToolError(error);
        }
        const memberships = z.array(BoardMembershipRowSchema).parse(data ?? []);
        return {
          content: [{ type: "text", text: JSON.stringify(memberships) }],
        };
      } catch (err) {
        return toToolError(err);
      }
    }
  );

  server.registerTool(
    "get_board",
    {
      description: "Get a board by id, including its task count per column.",
      inputSchema: boardIdInput,
    },
    async ({ boardId }) => {
      try {
        const boardResult = await ctx.supabase
          .from("boards")
          .select("*")
          .eq("id", boardId)
          .single();
        if (boardResult.error) {
          return toToolError(boardResult.error);
        }
        const board = BoardRowSchema.parse(boardResult.data);

        const tasksResult = await ctx.supabase
          .from("tasks")
          .select("column")
          .eq("board_id", boardId);
        if (tasksResult.error) {
          return toToolError(tasksResult.error);
        }
        const rows = TaskColumnCountRowSchema.parse(tasksResult.data ?? []);
        const counts = countTasksByColumn(rows);

        return {
          content: [{ type: "text", text: JSON.stringify({ board, counts }) }],
        };
      } catch (err) {
        return toToolError(err);
      }
    }
  );

  server.registerTool(
    "create_board",
    {
      description:
        "Create a new board (Pinnwand). Mints the owner membership and a join code.",
      inputSchema: { name: z.string().trim().min(1).max(100) },
    },
    async ({ name }) => {
      try {
        const { data, error } = await ctx.supabase.rpc("create_board", {
          p_name: name,
        });
        if (error) {
          return toToolError(error);
        }
        const board = BoardRowSchema.parse(data);
        return { content: [{ type: "text", text: JSON.stringify(board) }] };
      } catch (err) {
        return toToolError(err);
      }
    }
  );

  server.registerTool(
    "rename_board",
    {
      description: "Rename a board. Only the board's owner may rename it.",
      inputSchema: {
        ...boardIdInput,
        name: z.string().trim().min(1).max(100),
      },
    },
    async ({ boardId, name }) => {
      try {
        const { data, error } = await ctx.supabase
          .from("boards")
          .update({ name })
          .eq("id", boardId)
          .select()
          .single();
        if (error) {
          return toToolError(error);
        }
        const board = BoardRowSchema.parse(data);
        return { content: [{ type: "text", text: JSON.stringify(board) }] };
      } catch (err) {
        return toToolError(err);
      }
    }
  );

  server.registerTool(
    "delete_board",
    {
      description:
        "Delete a board and cascade its tasks. Only the board's owner may delete it.",
      inputSchema: boardIdInput,
    },
    async ({ boardId }) => {
      try {
        const { data, error } = await ctx.supabase
          .from("boards")
          .delete()
          .eq("id", boardId)
          .select("id");
        if (error) {
          return toToolError(error);
        }
        // RLS silently filters a delete the caller doesn't own: zero rows come
        // back with no error, so treat that the same as membership denial
        // instead of lying with a false "deleted: true".
        if (!data || data.length === 0) {
          return toToolError({
            code: "PGRST116",
            message: "no rows deleted",
          });
        }
        return {
          content: [{ type: "text", text: JSON.stringify({ deleted: true }) }],
        };
      } catch (err) {
        return toToolError(err);
      }
    }
  );

  server.registerTool(
    "join_board_by_code",
    {
      description: "Join a board using its share code.",
      inputSchema: { code: z.string().trim().min(1) },
    },
    async ({ code }) => {
      try {
        const { data, error } = await ctx.supabase.rpc("join_board_by_code", {
          p_code: code,
        });
        if (error) {
          return toToolError(error);
        }
        const board = BoardRowSchema.parse(data);
        return { content: [{ type: "text", text: JSON.stringify(board) }] };
      } catch (err) {
        return toToolError(err);
      }
    }
  );

  server.registerTool(
    "regenerate_join_code",
    {
      description:
        "Rotate a board's join code. Only the board's owner may rotate it.",
      inputSchema: boardIdInput,
    },
    async ({ boardId }) => {
      try {
        const { data, error } = await ctx.supabase.rpc("regenerate_join_code", {
          p_board: boardId,
        });
        if (error) {
          return toToolError(error);
        }
        const joinCode = z.string().parse(data);
        return {
          content: [
            { type: "text", text: JSON.stringify({ join_code: joinCode }) },
          ],
        };
      } catch (err) {
        return toToolError(err);
      }
    }
  );
}
