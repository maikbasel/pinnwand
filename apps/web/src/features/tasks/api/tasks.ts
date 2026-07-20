import { TASK_COLUMNS, TASK_PRIORITIES } from "@pinnwand/contracts";
import { z } from "zod";
import { supabase } from "@/shared/lib/supabase";
import type { Task } from "../types";

export const TASK_KEYS = {
  all: ["tasks"] as const,
  byBoard: (boardId: string) => ["tasks", "byBoard", boardId] as const,
};

export const TASK_MUTATION_KEYS = {
  // The generic prefix the offline resumable defaults register under; a paused
  // write's per-board key (below) prefix-matches it on replay.
  root: ["tasks", "mutate"] as const,
  forBoard: (boardId: string) => ["tasks", "mutate", boardId] as const,
};

type TaskColumnLiteral = (typeof TASK_COLUMNS)[number]["id"];
type TaskPriorityLiteral = (typeof TASK_PRIORITIES)[number]["id"];

const COLUMN_IDS = TASK_COLUMNS.map((c) => c.id) as [
  TaskColumnLiteral,
  ...TaskColumnLiteral[],
];
const PRIORITY_IDS = TASK_PRIORITIES.map((p) => p.id) as [
  TaskPriorityLiteral,
  ...TaskPriorityLiteral[],
];

const TaskColumnSchema = z.enum(COLUMN_IDS);
const TaskPrioritySchema = z.enum(PRIORITY_IDS);

const AssigneeRowSchema = z.object({ user_id: z.uuid() });

const TaskRowSchema = z.object({
  id: z.uuid(),
  board_id: z.uuid(),
  column: TaskColumnSchema,
  title: z.string(),
  description: z.string(),
  priority: TaskPrioritySchema,
  due_date: z.string().nullable(),
  position: z.number(),
  created_by: z.uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  task_assignees: z.array(AssigneeRowSchema).default([]),
});

const TASK_SELECT =
  'id,board_id,"column",title,description,priority,due_date,position,created_by,created_at,updated_at,task_assignees(user_id)';

function toTask(row: z.infer<typeof TaskRowSchema>): Task {
  return {
    id: row.id,
    boardId: row.board_id,
    column: row.column,
    title: row.title,
    description: row.description,
    priority: row.priority,
    dueDate: row.due_date,
    position: row.position,
    assigneeIds: row.task_assignees.map((a) => a.user_id),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listBoardTasks(boardId: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select(TASK_SELECT)
    .eq("board_id", boardId)
    .order("column", { ascending: true })
    .order("position", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) {
    throw error;
  }
  return z.array(TaskRowSchema).parse(data).map(toTask);
}

const CreateTaskInput = z.object({
  boardId: z.uuid(),
  column: TaskColumnSchema,
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000),
  priority: TaskPrioritySchema,
  dueDate: z.string().nullable(),
  position: z.number(),
});

export async function createTask(
  input: z.input<typeof CreateTaskInput>
): Promise<Task> {
  const parsed = CreateTaskInput.parse(input);
  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      board_id: parsed.boardId,
      column: parsed.column,
      title: parsed.title,
      description: parsed.description,
      priority: parsed.priority,
      due_date: parsed.dueDate,
      position: parsed.position,
      created_by: auth.user?.id ?? null,
    })
    .select(TASK_SELECT)
    .single();
  if (error) {
    throw error;
  }
  return toTask(TaskRowSchema.parse(data));
}

const UpdateTaskInput = z.object({
  taskId: z.uuid(),
  // Optional so a caller that does not own the title can leave it alone. The
  // detail sheet's inline field commits the title on its own; Save omits it
  // rather than re-sending a value that may lag behind that commit and write
  // the pre-edit name back over a rename.
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(5000),
  priority: TaskPrioritySchema,
  dueDate: z.string().nullable(),
});

export async function updateTask(
  input: z.input<typeof UpdateTaskInput>
): Promise<Task> {
  const parsed = UpdateTaskInput.parse(input);
  const { data, error } = await supabase
    .from("tasks")
    .update({
      ...(parsed.title === undefined ? {} : { title: parsed.title }),
      description: parsed.description,
      priority: parsed.priority,
      due_date: parsed.dueDate,
    })
    .eq("id", parsed.taskId)
    .select(TASK_SELECT)
    .single();
  if (error) {
    throw error;
  }
  return toTask(TaskRowSchema.parse(data));
}

const MoveTaskInput = z.object({
  taskId: z.uuid(),
  column: TaskColumnSchema,
  position: z.number(),
});

export async function moveTask(
  input: z.input<typeof MoveTaskInput>
): Promise<Task> {
  const parsed = MoveTaskInput.parse(input);
  const { data, error } = await supabase
    .from("tasks")
    .update({ column: parsed.column, position: parsed.position })
    .eq("id", parsed.taskId)
    .select(TASK_SELECT)
    .single();
  if (error) {
    throw error;
  }
  return toTask(TaskRowSchema.parse(data));
}

const ReorderTaskInput = z.object({ taskId: z.uuid(), position: z.number() });

export async function reorderTask(
  input: z.input<typeof ReorderTaskInput>
): Promise<Task> {
  const parsed = ReorderTaskInput.parse(input);
  const { data, error } = await supabase
    .from("tasks")
    .update({ position: parsed.position })
    .eq("id", parsed.taskId)
    .select(TASK_SELECT)
    .single();
  if (error) {
    throw error;
  }
  return toTask(TaskRowSchema.parse(data));
}

const RenormalizeColumnInput = z.object({
  boardId: z.uuid(),
  column: TaskColumnSchema,
  orderedIds: z.array(z.uuid()),
});

// Atomically renumbers a column to clean 1024-spacing in the given order via the
// `renormalize_column_positions` RPC. Used only when a single-row reorder can no
// longer place a card (the fractional-index gap between two neighbours is
// exhausted); the whole-column rewrite cannot be expressed as a per-row update.
export async function renormalizeColumnPositions(
  input: z.input<typeof RenormalizeColumnInput>
): Promise<void> {
  const parsed = RenormalizeColumnInput.parse(input);
  const { error } = await supabase.rpc("renormalize_column_positions", {
    p_board: parsed.boardId,
    p_column: parsed.column,
    p_ordered_ids: parsed.orderedIds,
  });
  if (error) {
    throw error;
  }
}

const DeleteTaskInput = z.object({ taskId: z.uuid() });

export async function deleteTask(
  input: z.input<typeof DeleteTaskInput>
): Promise<void> {
  const parsed = DeleteTaskInput.parse(input);
  const { error } = await supabase
    .from("tasks")
    .delete()
    .eq("id", parsed.taskId);
  if (error) {
    throw error;
  }
}

const SetAssigneesInput = z.object({
  taskId: z.uuid(),
  userIds: z.array(z.uuid()),
});

// Replaces the task's assignees with the given set in one atomic transaction via
// the `set_task_assignees` RPC (diff done server-side). A partial write can no
// longer leave a half-applied set, and concurrent edits can't interleave the way
// a client-side read-then-insert-then-delete could.
export async function setTaskAssignees(
  input: z.input<typeof SetAssigneesInput>
): Promise<void> {
  const parsed = SetAssigneesInput.parse(input);
  const { error } = await supabase.rpc("set_task_assignees", {
    p_task: parsed.taskId,
    p_user_ids: parsed.userIds,
  });
  if (error) {
    throw error;
  }
}
