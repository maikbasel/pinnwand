import { z } from "zod";
import { supabase } from "@/shared/lib/supabase";
import { TASK_COLUMNS, TASK_PRIORITIES } from "../columns";
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
  title: z.string().trim().min(1).max(200),
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
      title: parsed.title,
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

export async function setTaskAssignees(
  input: z.input<typeof SetAssigneesInput>
): Promise<void> {
  const parsed = SetAssigneesInput.parse(input);
  const { data: current, error: readError } = await supabase
    .from("task_assignees")
    .select("user_id")
    .eq("task_id", parsed.taskId);
  if (readError) {
    throw readError;
  }
  const existing = new Set(
    z
      .array(AssigneeRowSchema)
      .parse(current)
      .map((r) => r.user_id)
  );
  const next = new Set(parsed.userIds);
  const toInsert = parsed.userIds.filter((id) => !existing.has(id));
  const toDelete = [...existing].filter((id) => !next.has(id));
  if (toInsert.length > 0) {
    const { error } = await supabase
      .from("task_assignees")
      .insert(
        toInsert.map((userId) => ({ task_id: parsed.taskId, user_id: userId }))
      );
    if (error) {
      throw error;
    }
  }
  if (toDelete.length > 0) {
    const { error } = await supabase
      .from("task_assignees")
      .delete()
      .eq("task_id", parsed.taskId)
      .in("user_id", toDelete);
    if (error) {
      throw error;
    }
  }
}
