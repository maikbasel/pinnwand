// biome-ignore-all lint/performance/noBarrelFile: feature public surface per .claude/rules/architecture.md
// Public API of the `tasks` feature. Aufgaben: CRUD, drag-and-drop between the
// four fixed columns, priority, due date, assignees (Verantwortliche), realtime.
export {
  TASK_COLUMNS,
  TASK_PRIORITIES,
  type TaskColumnId,
  type TaskPriorityId,
} from "./columns";
