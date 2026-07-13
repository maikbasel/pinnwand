import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  DEFAULT_TASK_PRIORITY,
  TASK_COLUMNS,
  type TaskColumnId,
  type TaskPriorityId,
} from "@pinnwand/contracts";
import { z } from "zod";
import {
  TaskColumnSchema,
  TaskPrioritySchema,
  TaskRowSchema,
} from "../../schemas";
import { toToolError } from "../errors";
import { bottomPosition, midpoint } from "../position";
import type { ToolContext } from "../server";

const TASK_SELECT = "*, task_assignees(user_id)";

type TaskRow = z.infer<typeof TaskRowSchema>;

const AssigneeIdRowSchema = z.object({ user_id: z.uuid() });
const PositionRowSchema = z.object({ position: z.number() });
const NeighbourRowSchema = z.object({ id: z.uuid(), position: z.number() });
const CurrentTaskSchema = z.object({
  id: z.uuid(),
  board_id: z.uuid(),
  column: TaskColumnSchema,
  position: z.number(),
});

type TaskUpdatePatch = {
  title?: string;
  description?: string;
  priority?: TaskPriorityId;
  due_date?: string | null;
};

type SupabaseCtx = ToolContext["supabase"];

// Reads the target column's rows for the moved task's board, ordered by
// position, excluding the moved row itself — the same ordered set the web
// client's positionForMove() works from. Used to both validate a given
// beforeTaskId/afterTaskId actually belongs to this board+column and to find
// the TRUE adjacent neighbour on a one-sided move (never the row two slots
// away, and never a row from a different board/column).
async function fetchOrderedColumnRows(
  supabase: SupabaseCtx,
  boardId: string,
  column: TaskColumnId,
  excludeTaskId: string
): Promise<{ id: string; position: number }[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("id, position")
    .eq("board_id", boardId)
    .eq("column", column)
    .neq("id", excludeTaskId)
    .order("position");
  if (error) {
    throw error;
  }
  return z.array(NeighbourRowSchema).parse(data ?? []);
}

function requireIndexInColumn(
  ordered: readonly { id: string; position: number }[],
  taskId: string,
  argName: "beforeTaskId" | "afterTaskId"
): number {
  const index = ordered.findIndex((row) => row.id === taskId);
  if (index === -1) {
    throw new Error(`${argName} is not a task in the target column.`);
  }
  return index;
}

// Resolves the insertion position from validated before/after neighbours,
// using the row immediately adjacent in the ORDERED column set (not the
// naive "missing side = off the end" midpoint, which collides with the next
// row when columns are evenly spaced by POSITION_STEP).
function resolveNeighbourPosition(
  ordered: readonly { id: string; position: number }[],
  beforeTaskId: string | undefined,
  afterTaskId: string | undefined
): number {
  if (beforeTaskId && afterTaskId) {
    const beforeIndex = requireIndexInColumn(
      ordered,
      beforeTaskId,
      "beforeTaskId"
    );
    const afterIndex = requireIndexInColumn(
      ordered,
      afterTaskId,
      "afterTaskId"
    );
    return midpoint(
      ordered[beforeIndex].position,
      ordered[afterIndex].position
    );
  }
  if (beforeTaskId) {
    const beforeIndex = requireIndexInColumn(
      ordered,
      beforeTaskId,
      "beforeTaskId"
    );
    const trueNext = ordered[beforeIndex + 1];
    return midpoint(ordered[beforeIndex].position, trueNext?.position ?? null);
  }
  if (afterTaskId) {
    const afterIndex = requireIndexInColumn(
      ordered,
      afterTaskId,
      "afterTaskId"
    );
    const truePrev = afterIndex > 0 ? ordered[afterIndex - 1] : undefined;
    return midpoint(truePrev?.position ?? null, ordered[afterIndex].position);
  }
  // Unreachable: resolveMovePosition only calls this when at least one of
  // beforeTaskId/afterTaskId is set.
  throw new Error(
    "resolveNeighbourPosition requires a beforeTaskId or afterTaskId."
  );
}

async function resolveAppendPosition(
  supabase: SupabaseCtx,
  boardId: string,
  column: TaskColumnId,
  excludeTaskId?: string
): Promise<number> {
  // ponytail: only the current bottom row is needed to derive the append
  // position (bottomPosition takes its max), so fetch one row instead of the
  // whole column.
  let query = supabase
    .from("tasks")
    .select("position")
    .eq("board_id", boardId)
    .eq("column", column);
  if (excludeTaskId) {
    query = query.neq("id", excludeTaskId);
  }
  const { data, error } = await query
    .order("position", { ascending: false })
    .limit(1);
  if (error) {
    throw error;
  }
  return bottomPosition(z.array(PositionRowSchema).parse(data ?? []));
}

// Explicit position wins; else neighbours (before/after) resolve a midpoint
// against the TRUE adjacent row in the target board+column; else append to
// the end of the target column.
async function resolveMovePosition(
  supabase: SupabaseCtx,
  taskId: string,
  boardId: string,
  targetColumn: TaskColumnId,
  position: number | undefined,
  beforeTaskId: string | undefined,
  afterTaskId: string | undefined
): Promise<number> {
  if (position !== undefined) {
    return position;
  }
  if (!(beforeTaskId || afterTaskId)) {
    return resolveAppendPosition(supabase, boardId, targetColumn, taskId);
  }
  const ordered = await fetchOrderedColumnRows(
    supabase,
    boardId,
    targetColumn,
    taskId
  );
  return resolveNeighbourPosition(ordered, beforeTaskId, afterTaskId);
}

function groupTasksByColumn(rows: TaskRow[]): Record<TaskColumnId, TaskRow[]> {
  const grouped = Object.fromEntries(
    TASK_COLUMNS.map((c) => [c.id, [] as TaskRow[]])
  ) as Record<TaskColumnId, TaskRow[]>;
  for (const row of rows) {
    grouped[row.column].push(row);
  }
  return grouped;
}

export function registerTaskTools(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    "list_tasks",
    {
      description:
        "List a board's tasks, grouped by the four fixed columns (offen, zu_erledigen, in_bearbeitung, erledigt).",
      inputSchema: { boardId: z.uuid() },
    },
    async ({ boardId }) => {
      try {
        const { data, error } = await ctx.supabase
          .from("tasks")
          .select(TASK_SELECT)
          .eq("board_id", boardId)
          .order("column")
          .order("position");
        if (error) {
          return toToolError(error);
        }
        const rows = z.array(TaskRowSchema).parse(data ?? []);
        return {
          content: [
            { type: "text", text: JSON.stringify(groupTasksByColumn(rows)) },
          ],
        };
      } catch (err) {
        return toToolError(err);
      }
    }
  );

  server.registerTool(
    "get_task",
    {
      description: "Get a task by id, including its assignees.",
      inputSchema: { taskId: z.uuid() },
    },
    async ({ taskId }) => {
      try {
        const { data, error } = await ctx.supabase
          .from("tasks")
          .select(TASK_SELECT)
          .eq("id", taskId)
          .single();
        if (error) {
          return toToolError(error);
        }
        const task = TaskRowSchema.parse(data);
        return { content: [{ type: "text", text: JSON.stringify(task) }] };
      } catch (err) {
        return toToolError(err);
      }
    }
  );

  server.registerTool(
    "create_task",
    {
      description:
        "Create a task on a board, appended to the bottom of its column.",
      inputSchema: {
        boardId: z.uuid(),
        title: z.string().trim().min(1).max(200),
        description: z.string().max(5000).default(""),
        column: TaskColumnSchema.default("offen"),
        priority: TaskPrioritySchema.default(DEFAULT_TASK_PRIORITY),
        dueDate: z.string().date().nullable().optional(),
      },
    },
    async ({ boardId, title, description, column, priority, dueDate }) => {
      try {
        const position = await resolveAppendPosition(
          ctx.supabase,
          boardId,
          column
        );

        const { data, error } = await ctx.supabase
          .from("tasks")
          .insert({
            board_id: boardId,
            column,
            title,
            description,
            priority,
            due_date: dueDate ?? null,
            position,
            created_by: ctx.userId,
          })
          .select(TASK_SELECT)
          .single();
        if (error) {
          return toToolError(error);
        }
        const task = TaskRowSchema.parse(data);
        return { content: [{ type: "text", text: JSON.stringify(task) }] };
      } catch (err) {
        return toToolError(err);
      }
    }
  );

  server.registerTool(
    "update_task",
    {
      description:
        "Update a task's title, description, priority, and/or due date. At least one field is required.",
      inputSchema: {
        taskId: z.uuid(),
        title: z.string().trim().min(1).max(200).optional(),
        description: z.string().max(5000).optional(),
        priority: TaskPrioritySchema.optional(),
        dueDate: z.string().date().nullable().optional(),
      },
    },
    async ({ taskId, title, description, priority, dueDate }) => {
      try {
        const patch: TaskUpdatePatch = {};
        if (title !== undefined) {
          patch.title = title;
        }
        if (description !== undefined) {
          patch.description = description;
        }
        if (priority !== undefined) {
          patch.priority = priority;
        }
        if (dueDate !== undefined) {
          patch.due_date = dueDate;
        }
        if (Object.keys(patch).length === 0) {
          throw new Error("update_task requires at least one field to update.");
        }

        const { data, error } = await ctx.supabase
          .from("tasks")
          .update(patch)
          .eq("id", taskId)
          .select(TASK_SELECT)
          .single();
        if (error) {
          return toToolError(error);
        }
        const task = TaskRowSchema.parse(data);
        return { content: [{ type: "text", text: JSON.stringify(task) }] };
      } catch (err) {
        return toToolError(err);
      }
    }
  );

  server.registerTool(
    "move_task",
    {
      description:
        "Move a task to a column and/or position. Give an explicit position, or beforeTaskId/afterTaskId to place it between neighbours, or neither to append to the end of the target column.",
      inputSchema: {
        taskId: z.uuid(),
        column: TaskColumnSchema.optional(),
        position: z.number().optional(),
        beforeTaskId: z.uuid().optional(),
        afterTaskId: z.uuid().optional(),
      },
    },
    async ({ taskId, column, position, beforeTaskId, afterTaskId }) => {
      try {
        const currentResult = await ctx.supabase
          .from("tasks")
          .select("id, board_id, column, position")
          .eq("id", taskId)
          .single();
        if (currentResult.error) {
          return toToolError(currentResult.error);
        }
        const current = CurrentTaskSchema.parse(currentResult.data);
        const targetColumn = column ?? current.column;
        const newPosition = await resolveMovePosition(
          ctx.supabase,
          taskId,
          current.board_id,
          targetColumn,
          position,
          beforeTaskId,
          afterTaskId
        );

        const { data, error } = await ctx.supabase
          .from("tasks")
          .update({ column: targetColumn, position: newPosition })
          .eq("id", taskId)
          .select(TASK_SELECT)
          .single();
        if (error) {
          return toToolError(error);
        }
        const task = TaskRowSchema.parse(data);
        return { content: [{ type: "text", text: JSON.stringify(task) }] };
      } catch (err) {
        return toToolError(err);
      }
    }
  );

  server.registerTool(
    "assign_task",
    {
      description:
        "Assign a board member to a task (Verantwortliche). Adds to the current assignee set.",
      inputSchema: { taskId: z.uuid(), userId: z.uuid() },
    },
    async ({ taskId, userId }) => {
      try {
        // ponytail: read-modify-write over the full assignee set, mirroring the
        // web app. set_task_assignees replaces the whole set, so two concurrent
        // assigns can lose one add (last write wins). Acceptable at this app's
        // scale; revisit with a server-side add/remove RPC if it bites.
        const currentResult = await ctx.supabase
          .from("task_assignees")
          .select("user_id")
          .eq("task_id", taskId);
        if (currentResult.error) {
          return toToolError(currentResult.error);
        }
        const current = z
          .array(AssigneeIdRowSchema)
          .parse(currentResult.data ?? [])
          .map((row) => row.user_id);
        const nextIds = current.includes(userId)
          ? current
          : [...current, userId];

        const { error } = await ctx.supabase.rpc("set_task_assignees", {
          p_task: taskId,
          p_user_ids: nextIds,
        });
        if (error) {
          return toToolError(error);
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ task_id: taskId, assignee_ids: nextIds }),
            },
          ],
        };
      } catch (err) {
        return toToolError(err);
      }
    }
  );

  server.registerTool(
    "unassign_task",
    {
      description:
        "Remove a board member from a task's assignees (Verantwortliche).",
      inputSchema: { taskId: z.uuid(), userId: z.uuid() },
    },
    async ({ taskId, userId }) => {
      try {
        const currentResult = await ctx.supabase
          .from("task_assignees")
          .select("user_id")
          .eq("task_id", taskId);
        if (currentResult.error) {
          return toToolError(currentResult.error);
        }
        const current = z
          .array(AssigneeIdRowSchema)
          .parse(currentResult.data ?? [])
          .map((row) => row.user_id);
        const nextIds = current.filter((id) => id !== userId);

        const { error } = await ctx.supabase.rpc("set_task_assignees", {
          p_task: taskId,
          p_user_ids: nextIds,
        });
        if (error) {
          return toToolError(error);
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ task_id: taskId, assignee_ids: nextIds }),
            },
          ],
        };
      } catch (err) {
        return toToolError(err);
      }
    }
  );

  server.registerTool(
    "delete_task",
    {
      description: "Delete a task.",
      inputSchema: { taskId: z.uuid() },
    },
    async ({ taskId }) => {
      try {
        const { data, error } = await ctx.supabase
          .from("tasks")
          .delete()
          .eq("id", taskId)
          .select("id");
        if (error) {
          return toToolError(error);
        }
        // RLS silently filters a delete the caller doesn't own: zero rows come
        // back with no error, so treat that the same as membership denial
        // instead of lying with a false "deleted: true".
        if (!data || data.length === 0) {
          return toToolError({ code: "PGRST116", message: "no rows deleted" });
        }
        return {
          content: [{ type: "text", text: JSON.stringify({ deleted: true }) }],
        };
      } catch (err) {
        return toToolError(err);
      }
    }
  );
}
