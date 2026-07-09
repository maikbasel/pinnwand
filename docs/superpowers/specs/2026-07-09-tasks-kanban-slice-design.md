# Tasks / Kanban Slice Design

**Date:** 2026-07-09
**Status:** Approved for planning
**Feature slice:** `src/features/tasks` (with a small addition to `src/features/members`)

## Goal

Turn the board detail page from a placeholder into a working Kanban surface: the four fixed columns render their Aufgaben, members create and edit tasks, drag reorders within a column, a tap-driven control moves a task across columns, cards carry priority and Verantwortliche, a board-level drag gesture deletes with an Undo window, and everything stays live over realtime and durable offline.

## Scope decision

One spec, one staged implementation plan, merged as a single PR when the slice is done. The plan sequences the work as read/display, then create/edit, then drag reorder, then cross-column move, then assignees, then board-level delete. Each stage is independently testable; they ship together.

## Key finding: no new migration

The `init.sql` migration already defines everything this slice reads and writes:

- `tasks` (`id, board_id, "column", title, description, priority, due_date, position, created_by, created_at, updated_at`) with the `task_column` and `task_priority` enums and the `tasks_board_column_idx (board_id, "column", position)` index.
- `task_assignees` (`task_id, user_id` composite PK).
- `position` is `double precision` for fractional-index ordering.
- The `tasks_touch_updated_at` trigger maintains `updated_at` on every update.
- Full RLS: any board member has SELECT/INSERT/UPDATE/DELETE on that board's `tasks`; `task_assignees` is gated by membership of the parent task's board. Membership checks go through the `is_board_member` SECURITY DEFINER helper.

So this slice is `api/`, `hooks/`, `components/`, realtime, and offline wiring only. No SQL change, no RPC. The client computes fractional positions and writes them through the existing `tasks` UPDATE policy.

The offline plumbing is also already in place in `query-client.ts`: `tasks` and `board-members` are in `OFFLINE_QUERY_ROOTS` (reads persist), `tasks` is in `DURABLE_MUTATION_ROOTS` (writes survive an offline restart), `gcTime` is raised to the persist window, and the `scope.board` query-meta field is declared. `main.tsx` documents the exact slot for `registerTaskMutationDefaults(queryClient)`.

## Decisions log

| Decision | Choice |
|---|---|
| Ship shape | One spec, staged plan, single PR |
| Board layout | Board-first: slim header (name, Teilen, `⋯` menu), columns dominate. Mobile horizontal scroll-snap; desktop `md:grid-cols-4` side by side |
| Cross-column move | Tap card, detail sheet opens, column control moves it. Desktop also supports cross-column drag (all columns visible). No mobile cross-column auto-pan drag |
| Reorder within a column | Drag, fractional-index midpoint, only the moved row is written |
| Drag activation | `MouseSensor` distance 8 (immediate drag on mouse, click opens detail), `TouchSensor` delay 250 / tolerance 5 (long-press drag on touch, tap opens detail), `KeyboardSensor` (Space + arrows). Split sensors, routed by input type, not by viewport |
| Board-level delete | Long-press (touch) or drag (mouse) reveals a red Löschen drop zone. Deferred delete plus Undo snackbar |
| Delete safety | Deferred hard delete: optimistic removal, ~5s Undo snackbar, real DELETE fires only when the snackbar dismisses. No client-side re-insert |
| Realtime | One channel per board on `tasks` and `task_assignees`, invalidate the board's task query. Never a manual payload merge |
| Offline | Reads hydrate from IndexedDB; task writes pause and resume; conforms to the existing allowlist |
| Migration | None |

Both cross-column move and delete were researched against Trello, Linear, Jira, Asana, Todoist, Material 3, Apple HIG, NN/g, and WCAG 2.2. The tap-to-move control matches the most mobile-optimized apps and is the WCAG 2.5.7 non-drag path; deferred-delete-with-Undo matches Gmail and avoids the unsound re-insert that hard delete plus cascade plus realtime would otherwise require.

## Data layer (`src/features/tasks/api/tasks.ts`)

Query and mutation keys:

```
TASK_KEYS = {
  all: ["tasks"],
  byBoard: (boardId) => ["tasks", "byBoard", boardId],
}
TASK_MUTATION_KEYS = {
  forBoard: (boardId) => ["tasks", "mutate", boardId],
}
```

The mutation key's first segment is `"tasks"` so it matches `DURABLE_MUTATION_ROOTS` and survives an offline restart.

Functions, each validating its Supabase response with `zod` before returning:

- `listBoardTasks(boardId)`: selects `tasks` for the board with nested `task_assignees(user_id)`, ordered `"column", position, created_at, id`. Returns a typed `Task[]` where each task carries its assignee user ids.
- `createTask({ boardId, column, title, description, priority, dueDate, position })`: inserts with `created_by = auth.uid()` (RLS requires it). Returns the created row.
- `updateTask({ taskId, ...fields })`: updates title / description / priority / due_date. Returns the row.
- `moveTask({ taskId, column, position })`: sets column and position together (cross-column move or a reparented drop).
- `reorderTask({ taskId, position })`: sets position only (within-column reorder).
- `deleteTask({ taskId })`: hard delete; `task_assignees` rows cascade.
- `setTaskAssignees({ taskId, userIds })`: reconciles the join rows (insert missing, delete removed) so the set matches `userIds`. Assignees must be board members, which the `task_assignees` RLS insert policy enforces.

Zod schemas parse the enum columns (`task_column`, `task_priority`) and the row shape. Generated `database.ts` types describe the schema but not what actually arrived, so the parse stays.

## Position and reorder model

`position` is a `double precision` fractional index. A named `POSITION_STEP` constant (1024) spaces siblings. Order within a column is `position` ascending, tie-broken by `created_at` then `id` so concurrent writes never flicker.

- New task: `maxPositionInColumn + POSITION_STEP` (bottom). Empty column: `POSITION_STEP`.
- Reorder to an index: midpoint of the two neighbors, `(prev + next) / 2`. Top: `firstPos / 2`. Bottom: `lastPos + POSITION_STEP`. Only the moved row is written.
- Move to another column: set `column` plus `maxPos + POSITION_STEP` in the target (bottom). Predictable landing spot.
- Precision exhaustion: if a computed midpoint equals either neighbor (no representable gap left in the `double`), `reorderTask` first renormalizes that one column (rewrite its rows to evenly spaced `n * POSITION_STEP` in current order), then applies the move. Rare for a two-user board, handled rather than ignored.

The position math lives in a pure module (`src/features/tasks/lib/position.ts`) so it is unit-tested without React or Supabase.

## Hooks (`src/features/tasks/hooks/`)

- `useBoardTasks(boardId)`: query on `TASK_KEYS.byBoard`, `queryFn` calls `listBoardTasks`, `meta.scope.board = boardId`, gated `enabled: !!boardId`. Returns grouped-by-column, sorted tasks plus `isPending` / `isError` / `error`.
- `useCreateTask`, `useUpdateTask`, `useMoveTask`, `useReorderTask`, `useDeleteTask`, `useSetAssignees`: each is optimistic (cancel, snapshot, write, rollback on error, invalidate on settled) per the TanStack Query rule, tagged `mutationKey: TASK_MUTATION_KEYS.forBoard(boardId)` and `meta.scope.board`.
- `useBoardMembers(boardId)` (in `src/features/members`): reads the roster with profile display names for the assignee picker. Exported from `@/features/members`.
- `useBoardRealtime(boardId)`: subscribes and invalidates (below).

## Mutation defaults (`src/features/tasks/mutation-defaults.ts`)

`registerTaskMutationDefaults(queryClient)` sets `mutationFn` defaults keyed by `TASK_MUTATION_KEYS.forBoard`, so a task write queued in a prior offline session replays with no React scope. Wired into `main.tsx` at the documented slot, before the persister resumes.

## Interaction model

Card gestures, by input type (which sensor fires), not by viewport:

| Input | Pick up a card | Open detail |
|---|---|---|
| Mouse | Immediate drag (move 8px) | Click, no movement |
| Touch | Long-press (~250ms) then drag | Quick tap |
| Keyboard | Space, then arrows | Enter/Space on focus |

A touch tablet showing the desktop layout uses the `TouchSensor` (long-press), and because all columns are visible there, cross-column drag works. The viewport decides layout and whether cross-column drag is reachable; it never decides the gesture.

Deviation from `.claude/rules/dnd-kit.md`: the rule mandates a dedicated grip handle and warns whole-card drag fights tap-to-edit. The long-press-versus-tap split (activation delay on touch, distance on mouse) resolves that exact conflict, so the whole card is draggable and there is no separate handle. The rule also says "pointer sensor"; a `PointerSensor` captures touch too and its distance constraint would pre-empt the touch long-press, so this slice uses split `MouseSensor` plus `TouchSensor`. Both are resolved deviations to record in the rule.

## Detail sheet (view, edit, create)

Responsive swap: `vaul` bottom `Drawer` on mobile, side `Sheet` on desktop (the Linear/Height right-panel shape). One component, breakpoint-switched, mirroring `confirm-sheet.tsx`. Opening a card lands here; a `+` on a column header opens it in create mode with that column preset.

Fields:

- Titel: `input` (1 to 200, matches the DB check).
- Beschreibung: `textarea` (new Base UI primitive; optional, defaults to `""`).
- Spalte: `toggle-group` single-select over the four columns (new Base UI primitive). Primary cross-column move and the WCAG 2.5.7 non-drag path.
- Priorität: `toggle-group` single-select over Niedrig / Mittel / Hoch.
- Fällig am: native `<input type="date">` (nullable, OS-native picker).
- Verantwortliche: `AssigneePicker`, a `checkbox` list (new Base UI primitive) of board members from `useBoardMembers`, writing through `useSetAssignees`.
- Löschen: routes through the deferred-delete path (below); this is the accessible non-drag delete.

Edits are per-field optimistic (save on change, matching the board-rename pattern), so the sheet reflects each change instantly and rolls back on error. The sheet has a plain Close.

## Board-level delete: deferred delete plus Undo

Two entry points, one mechanism:

- Drag-to-zone: an active drag reveals a fixed red Löschen drop zone (`useDroppable`); dropping a card there triggers removal. No swipe (which would collide with horizontal scroll-snap paging), no per-card menu.
- Detail sheet Löschen: the same action as a tap. The WCAG 2.5.7 non-drag alternative and the keyboard path.

`useDeferredTaskDeletion(boardId)`, a provider scoped to `BoardSurface`:

1. On trigger: snapshot the task, add its id to a `pendingDeleteIds` set, show a sonner snackbar `Aufgabe gelöscht · Rückgängig` (~5s).
2. The board renders server tasks minus `pendingDeleteIds`, so the card stays hidden even if a realtime refetch lands mid-window (the row still exists server-side until the timer fires).
3. Rückgängig within the window: clear the timer, drop the id, the card returns. No server call was made.
4. Timer elapses: fire `useDeleteTask` (durable, offline-pausable). On error: rollback (id leaves the set, card returns) plus toast.

App closed inside the window: the DELETE never fired, so the task survives on next load. That fails safe toward not deleting, the right bias for a destructive action. Offline: the timer fires, the mutation pauses durably, resumes on reconnect.

Scope: delete only. The "Verschieben" move zone from the reference screenshot is not built, since cross-column move is already the detail-sheet picker. It can be added later.

## Realtime

`useBoardRealtime(boardId)`, mounted by `BoardSurface`: one channel per board subscribing to `postgres_changes` on `tasks` (filtered `board_id=eq.{boardId}`) and `task_assignees` (event `*`; the join table has no `board_id` to filter on and these events are rare). Any change invalidates `TASK_KEYS.byBoard(boardId)`. Never a manual payload merge. The channel is torn down on unmount; Supabase auto-resubscribes on reconnect and the invalidation reconciles, the same contract as online.

## Offline

- Reads persist automatically (`tasks` and `board-members` already allowlisted, `gcTime` already raised). `BoardSurface` gates on `useIsRestoring()` so the board hydrates from IndexedDB on a cold offline launch without an empty flash, the guard `WeekView` uses in the reference stack.
- Writes: every task mutation uses the durable `TASK_MUTATION_KEYS.forBoard` key, default `networkMode` (pauses offline), and self-contained variables. `registerTaskMutationDefaults` is registered in `main.tsx` before restore. `resumePausedMutations()` already runs on restore.
- Every task query carries `meta.scope.board` for a future sync indicator.

Sharing operations (create / join / rename / delete board, join codes) stay online-only and are out of this slice.

## Components

Under `src/features/tasks/components/` unless noted:

- `board-detail-page.tsx` (edited, in `src/features/boards`): board-first header (inline-editable name, Teilen button opening `board-share-panel` in a sheet/dialog, `⋯` `dropdown-menu` with Umbenennen and Löschen for owners or Verlassen for members), then `<BoardSurface boardId />`. Replaces the `TASKS_PLACEHOLDER` card.
- `BoardSurface`: owns the `DndContext` (three sensors), `useBoardTasks`, `useBoardRealtime`, and `DeferredDeleteProvider`. Renders the column strip (mobile horizontal scroll-snap, desktop `md:grid-cols-4`), the `DeleteDropZone` (shown only during an active drag), and the `TaskDetailSheet`.
- `TaskColumn`: header (label, task count, `+`), a `SortableContext`, the card list, an empty-column placeholder, and a droppable for desktop cross-column drops.
- `TaskCard`: `useSortable`; face is the truncated title, `PriorityBadge`, assignee avatar stack (3 plus "+N"), and a due-date chip when set. Whole card draggable; tap opens the sheet.
- `TaskDetailSheet`, `AssigneePicker`, `PriorityBadge`, `AssigneeAvatars`, `DeleteDropZone`.
- `src/features/members`: `api/members.ts`, `hooks/use-board-members.ts`, exporting `useBoardMembers` and `BoardMember`.

New shadcn-style primitives on Base UI (`src/shared/components/ui/`, per `components.md`, authored on `@base-ui/react`, not Radix): `textarea`, `toggle-group` (with `toggle`), `checkbox`. Everything else reuses existing primitives: `button`, `card`, `badge`, `avatar`, `drawer`, `sheet`, `dropdown-menu`, `alert`, `skeleton`, `empty`, `sonner`, `input`, `scroll-area`, `separator`, `confirm-sheet`.

## States

Every state is designed in, per `production-grade.md`:

- Loading: `useIsRestoring()` or `isPending` renders column skeletons, never a full-page spinner.
- Empty board (all four columns empty): a centered CTA, "Erste Aufgabe erstellen", opens create for Offen.
- Empty column: a muted "Keine Aufgaben" placeholder; the `+` stays.
- Error: `isError` renders a destructive `alert` with a retry (refetch); the board header still renders.
- Offline: the existing `OfflineIndicator`; mutations stay optimistic; inputs are never disabled on offline alone.
- Mutation failure: global toast plus optimistic rollback.
- Long titles: `line-clamp` on the card, full text in the sheet.
- Double-submit: the create button guards on `isPending`, the rename guard already in the codebase.

## Copy

German UI strings live in `src/features/tasks/lib/copy.ts` as named constants (no inline literals). Column and priority labels come from the existing `columns.ts`. Copy covers create, edit, delete, Undo, empty, error, and the assignee picker.

## Testing

- Vitest unit: the pure position math (midpoint, top, bottom, renormalize on exhaustion); each hook's optimistic add / move / reorder / assign plus rollback; the deferred-delete state machine with fake timers (timer fires triggers mutate; Undo skips mutate; `pendingDeleteIds` filters a mid-window refetch); api `zod` parse on valid and malformed rows. Assertions go through roles and copy constants, not hardcoded strings or pixels.
- Integration (existing `with-rls` harness): RLS by impersonation (sign in as member B, `listBoardTasks(boardA)` returns empty); `task_assignees` gated by board membership; a create / move / delete round-trip under RLS.
- Playwright e2e (sealed stack): create a task, edit the title, move via the sheet column control, drag-reorder within a column, delete via drag-to-zone plus Undo and a committed delete; realtime across two browser contexts (alice and bob on the shared board); an offline create then reconnect then sync journey via `context.setOffline`.

## Rule updates on merge

- `.claude/rules/dnd-kit.md`: record the resolved deviation (whole-card long-press drag with split Mouse/Touch sensors, no grip handle) and correct the "pointer sensor" guidance.
- `.claude/rules/documentation.md` checklist: `CLAUDE.md` still describes the stack; the tasks slice now ships, so the `TASKS_PLACEHOLDER` note is gone.

## Out of scope

- Any board CRUD or sharing change (online-only, separate concern).
- An archive concept or an archive view (delete uses deferred hard delete plus Undo).
- A per-card quick-move menu and a "Verschieben" drag zone.
- Task comments, attachments, labels, checklists, or column CRUD (the four columns are fixed).
