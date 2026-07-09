// The four fixed Kanban columns. `id` matches the Postgres `task_column` enum;
// `label` is the German UI text. Order here is the board's left-to-right order.
export const TASK_COLUMNS = [
  { id: "offen", label: "Offen" },
  { id: "zu_erledigen", label: "Zu Erledigen" },
  { id: "in_bearbeitung", label: "In Bearbeitung" },
  { id: "erledigt", label: "Erledigt" },
] as const;

export type TaskColumnId = (typeof TASK_COLUMNS)[number]["id"];

// Task priorities. `id` matches the Postgres `task_priority` enum; `label` is
// the German UI text; `tone` maps to a badge color in the UI layer.
export const TASK_PRIORITIES = [
  { id: "niedrig", label: "Niedrig", tone: "muted" },
  { id: "mittel", label: "Mittel", tone: "amber" },
  { id: "hoch", label: "Hoch", tone: "red" },
] as const;

export type TaskPriorityId = (typeof TASK_PRIORITIES)[number]["id"];

// Priority a quick-add card starts with. Full edit (priority/due/assignees)
// happens later in the task detail sheet; the inline composer only takes a
// title, so it needs a sensible default.
export const DEFAULT_TASK_PRIORITY: TaskPriorityId = "mittel";
