// Row schemas the mcp tools parse Supabase results through (Tasks 6-8).
//
// This is a deliberate second copy of the shapes in apps/web/src/features/*/api/*.ts:
// the web's schemas carry web-specific query-key coupling and stay independent.
// Both copies reuse the same TASK_COLUMNS/TASK_PRIORITIES source of truth from
// @pinnwand/contracts for the enums.
import { TASK_COLUMNS, TASK_PRIORITIES } from "@pinnwand/contracts";
import { z } from "zod";

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

export const TaskColumnSchema = z.enum(COLUMN_IDS);
export const TaskPrioritySchema = z.enum(PRIORITY_IDS);

export const BoardRowSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  join_code: z.string(),
  created_by: z.uuid().nullable(),
  created_at: z.string(),
});

const TaskAssigneeRowSchema = z.object({ user_id: z.uuid() });

export const TaskRowSchema = z.object({
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
  task_assignees: z.array(TaskAssigneeRowSchema).default([]),
});

export const MemberRowSchema = z.object({
  user_id: z.uuid(),
  role: z.enum(["owner", "member"]),
  profiles: z.object({ display_name: z.string() }).nullable(),
});
