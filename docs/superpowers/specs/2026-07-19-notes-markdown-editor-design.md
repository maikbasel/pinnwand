# Notizen: collaborative markdown notes

Status: approved, not yet implemented
Date: 2026-07-19

## Summary

Board-scoped notes written in a rich markdown editor, synced in real time between board members via a Yjs CRDT. A note belongs to exactly one board and is visible to that board's members, using the same RLS boundary as tasks.

The editor is Tiptap 3 bound to a `Y.Doc`. Document state syncs through an append-only Postgres table observed with `postgres_changes`. Cursor positions sync through a separate ephemeral broadcast channel carrying the `y-protocols` awareness protocol.

## Goals

- Create and delete notes on a board. A note is titled by its first line, not renamed separately.
- Rich text editing where markdown structure renders as you type: headings, bold, italic, lists, task lists, quotes, code blocks, links.
- Two members editing one note converge without losing work, including when both edited offline.
- Live carets showing where each member is in the document.
- Read-only markdown source view for copying and exporting.
- Offline-first: notes readable and editable offline, writes resume on reconnect.

## Non-goals

- Full markdown coverage. Footnotes, math, definition lists, and inline HTML are out of scope. The supported set is what Tiptap StarterKit plus TaskList models, and that set is the contract, not "all of markdown".
- Editable source view. See "Read-only source view" below for why.
- Transforming a note into a task. Deferred until real usage shows what the transform should do.
- Note search or full-text indexing.
- Note attachments or images.

## Domain model

A note belongs to a board. Board membership is the only access boundary, consistent with tasks.

### `public.notes`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` pk | `default gen_random_uuid()` |
| `board_id` | `uuid not null` | `references public.boards(id) on delete cascade` |
| `title` | `text not null default ''` | Written by the client, derived from the document's first line |
| `snapshot_b64` | `text` | `Y.encodeStateAsUpdate` output, base64. Null until first compaction |
| `snapshot_up_to_id` | `bigint not null default 0` | Highest `note_updates.id` folded into the snapshot |
| `created_by` | `uuid not null` | `references public.profiles(id)` |
| `created_at` | `timestamptz not null default now()` | |
| `updated_at` | `timestamptz not null default now()` | Set by trigger on any `notes` update, so the list can sort by recency |

There is no separate rename operation. `title` is a derived cache of the document's first line, written by the client on the same debounce as the update insert. It exists so the notes list is a plain indexed query rather than requiring CRDT decoding in Postgres.

### `public.note_updates`

Append-only log of Yjs document updates. This table is both the durable store and the sync transport.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `bigserial` pk | Provides total ordering |
| `note_id` | `uuid not null` | `references public.notes(id) on delete cascade` |
| `update_b64` | `text not null` | A single Yjs update, base64 |
| `created_at` | `timestamptz not null default now()` | |

Index on `(note_id, id)`.

### Why base64 text and not `bytea`

PostgREST renders `bytea` in hex, which doubles the wire size, and Supabase Realtime has a documented double-encoding defect with `bytea` payloads. Base64 costs 33 percent and has neither problem.

Note the asymmetry with the awareness channel, which does send raw binary. That channel is a websocket broadcast and never passes through PostgREST or the WAL, so the constraints do not apply there.

### Why `board_id` is not denormalized onto `note_updates`

The RLS policy resolves the board through a join on `notes`, matching the existing `task_assignees` policies, which already use this shape. Consistency with the established pattern beats saving one primary-key lookup per insert.

## RLS

Every policy routes through the existing `public.is_board_member(uuid)` SECURITY DEFINER helper, as tasks do.

`notes`: `select`, `insert`, `update`, `delete` all gated on `public.is_board_member(board_id)`. `insert` additionally requires `created_by = auth.uid()`, mirroring `tasks_insert`.

`note_updates`: `select` and `insert` only.

```sql
create policy note_updates_select on public.note_updates for select
using (exists (
  select 1 from public.notes n
  where n.id = note_updates.note_id and public.is_board_member(n.board_id)
));

create policy note_updates_insert on public.note_updates for insert
with check (exists (
  select 1 from public.notes n
  where n.id = note_updates.note_id and public.is_board_member(n.board_id)
));
```

There is deliberately **no `update` policy and no `delete` policy**. The log is append-only to clients by construction rather than by convention. Deletion happens only through the compaction function below.

## Compaction

The log grows one row per 400 ms of active typing. Left alone it would make the open path slower forever.

`public.compact_note(p_note_id uuid, p_snapshot_b64 text, p_up_to_id bigint)` is SECURITY DEFINER. It re-checks `is_board_member` against the note's board, writes `snapshot_b64` and `snapshot_up_to_id` onto `notes`, and deletes `note_updates` rows for that note with `id <= p_up_to_id`. This is why clients need no delete policy.

The client calls it opportunistically on close when the log exceeds **500 rows**, which is `PREFERRED_TRIM_SIZE` from Yjs's own `y-indexeddb`. Using the upstream constant rather than an invented threshold.

Known limitation, quoted from the Yjs documentation: merging updates "doesn't garbage-collect deleted content. You still need to load the document to a Y.Doc to reduce the document size." Compaction runs on a client that already has the document loaded, so it produces a genuinely garbage-collected snapshot rather than a merge of encoded updates.

Yjs retains a per-client entry in the state vector permanently. A note edited by a bounded set of teammates is fine. This is documented as a known ceiling, not a defect to design around now.

## Sync architecture

The log is the transport. Clients subscribe to `note_updates` inserts via `postgres_changes` filtered on `note_id`.

This is the decision that keeps the provider small. Broadcast is lossy, unordered, and has no backlog, so using it as the transport means owning a resync protocol, missed-message detection, and state-vector reconciliation. Since note content must be durable, the row is written either way. The log therefore gives durability and transport for one write:

| Broadcast as transport | Log as transport |
| --- | --- |
| Delivery not guaranteed | Row is committed |
| No ordering guarantee | `bigserial id` orders it |
| Missed messages while disconnected | `where id > lastSeenId` |
| State-vector reconciliation needed | Not needed |
| Separate initial-state path | Same query from `id > snapshot_up_to_id` |

The cost is latency. Remote edits land in roughly 100 to 300 ms rather than 20 to 50 ms, because the path is write, WAL, Realtime, peers. Local typing is instant regardless, since Yjs applies the local edit before anything touches the network.

Broadcast can be layered on later as a pure fast path with no schema change: broadcast for speed, log rows for truth, client applies whichever arrives first. Yjs updates are idempotent and commutative, so double application is a no-op. Starting log-only forecloses nothing.

### Realtime publication

`alter publication supabase_realtime add table public.note_updates;`

Subscribed with `filter: note_id=eq.<id>`, INSERT events only.

**Default replica identity, deliberately.** Only INSERT events are consumed, and INSERT WAL records always carry the full new tuple, so the `note_id` filter matches. Compaction DELETEs will not match the filter, which is correct since clients ignore them. This avoids the WAL doubling that `replica identity full` would impose on every row.

### Client lifecycle

**Open.** Create `Y.Doc`, attach `y-indexeddb`. If online: fetch the note row, apply `snapshot_b64`, then fetch and apply `note_updates where note_id = $1 and id > snapshot_up_to_id` in `id` order. Subscribe. Track `lastSeenId`.

**Edit.** Buffer Yjs updates. Every 400 ms, collapse the buffer with `Y.mergeUpdates` and insert one row. One row per 400 ms of typing, not one per keystroke.

**Remote insert.** `Y.applyUpdate`, advance `lastSeenId`. Skip rows this client wrote.

**Reconnect.** Query `id > lastSeenId`. **Edge case that must be handled:** if the note was compacted while this client was away, `lastSeenId` points at deleted rows. So check `snapshot_up_to_id > lastSeenId` first and re-apply the snapshot before the incremental updates. Applying an already-seen snapshot is a no-op in Yjs, so this needs no further cleverness.

**Close.** Flush the buffer. Compact if the log exceeds 500 rows.

## Awareness and carets

A **second, separate channel**, topic `awareness:<noteId>`, using **broadcast only**. Separate from the `note_updates` subscription because the two have different lifetimes and failure modes, and carets must tear down without disturbing durable sync.

### Why broadcast and not Presence

Two independent reasons, either sufficient.

Self-hosted Realtime enforces `CLIENT_PRESENCE_MAX_CALLS = 5` per `CLIENT_PRESENCE_WINDOW_MS = 30000`, added in realtime v2.76.0 and present in the pinned v2.93.2. Five presence calls per 30 seconds is not enough for cursor updates, or even for the awareness heartbeat. Supabase's own documentation directs high-frequency updates to Broadcast.

Architecturally, `y-protocols` awareness already **is** a presence protocol, with its own per-client clock, its own 30 second peer expiry, and its own tombstone mechanism. Running Presence underneath it means two clocks, two lifecycles, and two identity spaces that will disagree. Any bridge reconciling them races the built-in authority, which is how implementations acquire ghost and flapping carets.

Presence remains the right tool for slow-changing membership. It is not used in this feature.

### Awareness gives the member list for free

`editor.storage.collaborationCaret.users` exposes the connected members as `{ clientId, ...user }`. The "who is in this note" indicator reads from there. No second mechanism.

### Built-in heartbeat: do not reimplement

`y-protocols` ticks every 3000 ms, renews local state when it is 15 seconds stale, and expires peers after 30 seconds of silence (`outdatedTimeout = 30000`). No heartbeat code is written. The only obligation is that the `update` event from self-renewal actually reaches the wire, which constrains the throttle below.

### Wiring

`CollaborationCaret.configure({ provider: { awareness }, user })`. Reading the 3.28.0 source, the extension's entire use of `provider` is `provider.awareness`, so a bare object satisfies it. No Hocuspocus provider is required despite what the JSDoc suggests.

`@tiptap/y-tiptap` owns the `cursor` awareness field, deduplicates by relative position, and nulls the field on `focusout`. Tab switching therefore clears the local caret for other members without any visibility code.

### Outbound rule

Subscribe to `awareness.on('update', ({added, updated, removed}, origin) => ...)`.

**Send only when the changed-client set contains the local `clientID`.**

Not filtering on `origin === 'local'`. That would miss the case where a remote incorrectly nulls this client and `applyAwarenessUpdate` bumps the local clock so it re-announces. That update arrives with a remote origin but must go out. Filtering on the client set covers it.

This also prevents relaying third-party state, which would turn fanout into n squared. Each peer is authoritative only about itself.

Payload: `encodeAwarenessUpdate(awareness, [awareness.clientID])`.

### Throttle: 100 ms, on the send, never on the event

The `update` handler runs unthrottled and accumulates changed client IDs into a pending set. The **flush** is throttled at 100 ms, leading and trailing edge, encoding from current awareness state at flush time.

Throttling the event instead is the defect in `kevinamick/supabaseprovider`: it debounces the handler, so `removed` entries from suppressed calls are discarded and ghost carets persist until the remote 30 second timeout. Debouncing also freezes carets during continuous typing, which is exactly when they should move.

**Removals bypass the throttle.** If the pending set contains a removal, or local state just became null, flush immediately. Removals are rare and correctness-critical.

100 ms matches the Liveblocks default. Text carets move in discrete jumps, and network latency already exceeds the frame budget, so a faster rate buys nothing observable while tripling radio wakeups on mobile.

### Late joiner

Fire-and-forget broadcast retains no state, so a joining client sees nobody until each peer next moves. Both existing community providers have this hole.

On `SUBSCRIBED`: broadcast own state, and separately broadcast a zero-payload `awareness:query` event. Peers receiving `awareness:query` reply with **their own state only**, jittered 0 to 200 ms. Convergence is one round trip.

Peers must not reply with their full `states` map. Each peer is authoritative only about itself, and relaying third-party state can resurrect a peer that already died.

The 15 second self-renewal is the safety net, so a lost handshake is a latency bug rather than a correctness bug.

Broadcast Replay is not applicable: it only replays database-triggered broadcasts on private channels, which would mean writing awareness to a table.

### Binary encoding, and one sharp edge

Binary websocket broadcast is supported: the v2 serializer shipped in realtime **v2.63.0** (Nov 2025), and the pinned v2.93.2 includes it. Client side needs supabase-js 2.91.0 or later; 2.105.3 is pinned.

Note this is a different feature from binary payloads in `realtime.messages`, which is v2.98.0 and applies only to Broadcast-from-Database. Not relevant here.

**The serializer checks `instanceof ArrayBuffer` and does not check `ArrayBuffer.isView`.** This is still true as of 2.110.7. Passing the `Uint8Array` returned by `encodeAwarenessUpdate` silently falls through to `JSON.stringify`, producing `{"0":12,"1":3,...}` at roughly 5 bytes per payload byte.

The update must be converted to an exact `ArrayBuffer` by slicing `[byteOffset, byteOffset + byteLength)`. lib0's encoder over-allocates, so the raw `.buffer` carries trailing garbage that `applyAwarenessUpdate` would attempt to parse.

Inbound handlers receive an `ArrayBuffer` and must wrap it in a `Uint8Array`.

`send()` silently falls back to REST when the channel is not pushable, and the REST path `JSON.stringify`s the payload, corrupting binary. **Only send after `subscribe()` reports `SUBSCRIBED`.**

Decode is wrapped: a truncated or malformed update throws inside `applyAwarenessUpdate`, and an unhandled throw in a channel callback is a swallowed error. Catch, surface once, drop the message. The sender's next heartbeat repairs within 15 seconds.

### Disconnect and teardown

On `CHANNEL_ERROR`, `TIMED_OUT`, or `CLOSED`: `removeAwarenessStates` for every remote client. Nothing can be heard, so nothing is present. Clearing immediately beats showing 30 seconds of stale ghosts. Re-run the full handshake on the next `SUBSCRIBED`.

On unmount: `awareness.off('update', handler)` with the **same function reference** that was registered (`supabaseprovider` passes the unbound method and leaks the listener, which React 19 StrictMode exercises on every dev mount), then send the tombstone, then remove the channel, then `awareness.destroy()`.

On page teardown: `pagehide` plus `visibilitychange` to hidden, guarded by an idempotence flag. **Never `beforeunload`**, which is the mobile defect in both community providers, since iOS Safari and Android Chrome discard backgrounded tabs without firing it.

If the tombstone never lands, the 30 second timeout collects the ghost. Cleanup is best-effort by design.

### Mobile

Socket loss on backgrounding is a **normal, frequent** path, not an exception branch. The clear-remotes then re-handshake path must be tested by backgrounding for two minutes, not by killing the network.

A frozen or bfcached page runs no timers, so self-renewal stops and peers expire this client at 30 seconds. That is correct: a frozen tab is not present. On resume, the first tick expires stale peers and local renewal re-announces. The protocol self-heals with no resume-detection code.

On `visibilitychange` to hidden: stop outbound sends but keep the channel. A two second tab switch should not cost a resubscribe. On return to visible: verify channel state and resubscribe plus re-handshake if not joined.

## Editor and UI

Tiptap 3 with StarterKit, TaskList, and `@tiptap/extension-collaboration` bound to the `Y.Doc`, plus `@tiptap/extension-collaboration-caret`.

The board route gains a `Board | Notizen` switch. Desktop shows the note list beside the editor. Mobile makes the list a full screen; tapping a note pushes to the editor, consistent with the existing mobile-first pattern.

`title` is derived client-side from the document's first line and written on the same 400 ms debounce as the update insert. This keeps the notes list a plain indexed query rather than requiring CRDT decoding in Postgres.

### Read-only source view

The source view renders markdown for reading, copying, and export. It is **not editable**.

Editing markdown source means parsing the text and replacing the whole document, which discards every concurrent edit and defeats the CRDT. Collaborative source editing is genuinely hard and is named as a limitation rather than shipped as a footgun.

This narrows the original request, which asked for a MarkText-style source toggle. Recorded here so the constraint is a decision rather than an oversight.

### German copy

UI copy is German, consistent with the rest of the app. Notes are "Notizen".

## Offline

`note_updates` inserts are ordinary TanStack mutations. Add `"notes"` to `DURABLE_MUTATION_ROOTS` and `OFFLINE_QUERY_ROOTS` in `query-client.ts`, and register mutation defaults in `main.tsx` **before the persister resumes**, matching the tasks pattern.

The `Y.Doc` persists separately through `y-indexeddb`. Two persistence layers with distinct jobs: the TanStack persister holds the notes **list**, `y-indexeddb` holds the **document**.

**This is where the CRDT earns its cost.** Two members edit the same note offline. Both reconnect. Both sets of rows land. Both clients apply both sets and converge. No conflict banner, no lost paragraph, no user decision. Out-of-order resume is safe because Yjs updates are commutative. Last-write-wins cannot do this, and it is the primary justification for the architecture.

## Feature slice

```
apps/web/src/features/notes/
├── index.ts
├── types.ts
├── api/
│   └── notes.ts              Supabase calls, zod parsing at the boundary
├── lib/
│   ├── awareness-channel.ts  broadcast transport for y-protocols awareness
│   └── note-doc.ts           Y.Doc lifecycle, log apply, compaction trigger
├── hooks/
│   ├── use-board-notes.ts
│   ├── use-note-doc.ts
│   ├── use-create-note.ts
│   ├── use-delete-note.ts
│   └── use-note-realtime.ts
└── components/
    ├── notes-list.tsx
    ├── note-editor.tsx
    └── note-source-view.tsx
```

Layer boundaries per `architecture.md`. Components import hooks, never `api/` or `@supabase/*`. `lib/` holds the Yjs and channel plumbing, imported by hooks.

The awareness channel is the one place touching `supabase` outside `api/`. It is transport, not data access, and belongs in `lib/` alongside the `Y.Doc` lifecycle it serves.

## Testing

Unit (Vitest):
- Apply updates in `id` order reconstructs expected document state.
- Resync from `lastSeenId`.
- Compacted-while-offline path: `snapshot_up_to_id > lastSeenId` re-applies the snapshot.
- `Y.mergeUpdates` batching collapses a buffer to one update.
- Awareness outbound filter sends only when the changed set contains the local `clientID`.
- Throttle accumulates changed IDs across suppressed events and never drops a removal.
- `ArrayBuffer` conversion produces exactly `byteLength` bytes with no trailing garbage.

Convergence property test: apply a set of updates in randomised orders across two docs, assert identical final state. This is the invariant the whole architecture rests on.

Integration (`vitest.integration.config.ts`, testcontainers):
- User A inserts into `note_updates` for user B's note: denied.
- User A selects user B's notes: empty.
- `compact_note` called by a non-member: denied.
- Client `update` and `delete` on `note_updates`: denied.

E2E (Playwright):
- Two contexts editing one note converge.
- Carets appear in both directions.
- Late joiner sees existing carets within one round trip.
- Both contexts edit offline, reconnect, converge without loss.

## Operational notes

Self-hosted Realtime tenant limits at v2.93.2, currently at defaults since compose overrides none of them:

```
TENANT_MAX_EVENTS_PER_SECOND     100
TENANT_MAX_BYTES_PER_SECOND      100_000
TENANT_MAX_CONCURRENT_USERS      200
TENANT_MAX_CHANNELS_PER_CLIENT   100
TENANT_MAX_JOINS_PER_SECOND      100
```

These are **per tenant**, not per channel, and shared with existing Kanban board traffic.

Estimated load: five members typing in different notes is roughly 12 events per second from document updates, plus up to 10 per second per actively-typing member from awareness. Worst realistic case sits near 50 against a limit of 100.

The limits are raisable by environment variable on the `realtime` service or per row in `_realtime.tenants`. **Do not raise them for this feature.** Raising a limit removes a guardrail without creating capacity, converting a loud failure into latency and dropped connections. Revisit only if concurrent usage grows well past a handful of simultaneous editors.

## Rejected alternatives

**Last-write-wins with a version column.** One to two days instead of roughly a week, no new concepts. Rejected because it cannot merge concurrent offline edits, and this app is offline-first. See the Offline section.

**`pg_crdt`.** Last commit 2025-04-11, zero releases, install questions unanswered since 2024. Supabase's own blog: "pg_crdt has not been released onto the Supabase platform (and it may never be)." Absent from the `supabase/postgres` image, so adopting it means maintaining a forked Postgres image forever. Yjs support was dropped in an April 2025 rewrite to `automerge-c`. Architecturally it provides server-side merge only and no client sync transport. Its own documentation notes the WAL carries a complete document copy per change, which combined with `replica identity full` would broadcast the entire note on every keystroke.

**`y-supabase` and `kevinamick/supabaseprovider`.** Abandoned 2023 and 2024 respectively, both still pre-release, both predating the v2 binary serializer, the presence rate limiter, and Tiptap 3. `y-supabase` carries an open correctness issue titled "Updates will overwrite each other" filed the day after its final release. Read for shape; the specific defects they contain are called out inline above.

**Hosted collaboration backends** (Liveblocks, Tiptap Cloud). None can verify a GoTrue JWT; all mint their own token from a secret that cannot live in a browser. They remove provider code but not the backend requirement.

**Hocuspocus.** The strongest pure engineering option: MIT, actively maintained, `onAuthenticate` can verify the Supabase JWT against the JWKS published since commit `022159a`, and `extension-database` is roughly 15 lines against the existing Postgres. Two to three days. Rejected because it is a second always-on service, violating the no-bespoke-backend invariant in `CLAUDE.md`. Reconsider only alongside an explicit decision to change that rule, recorded as a resolved deviation in `architecture.md`.

**Automerge and Loro.** Automerge parses the benchmark document in 1805 ms against Yjs's 39 ms, which is a visible stall on mobile, and its ProseMirror binding self-describes as beta with no Tiptap support. Loro is technically excellent and parses fastest, but has no Tiptap binding, which would have to be written.

**ElectricSQL.** Read-path only since the July 2024 rewrite, with no CRDT layer, and requires a separate stateful Elixir container. That is the bespoke backend, for half a solution.

**Broadcast as the document transport.** Covered in Sync architecture. Since durability requires the row anyway, broadcast would be a second delivery path requiring reconciliation with the first.

**Presence as the awareness transport.** Covered in Awareness. Hard rate limit of five calls per 30 seconds, plus duplicated clock and lifecycle against a protocol that already has both.

## Risks

**Provider ownership.** No maintained Yjs-Supabase provider exists, so this code is owned outright. Mitigated by keeping it small (the awareness layer is roughly 80 lines), by the protocol being fully specified above, and by the convergence property test.

**Latency perception.** Remote edits at 100 to 300 ms will not feel like Google Docs. If it grates, broadcast can be added as a fast path with no schema change.

**State vector growth.** Yjs retains a per-client entry permanently. Bounded teammate sets are fine; a note touched by thousands of distinct clients would accrete metadata that compaction cannot remove. Documented ceiling, not a current problem.

**supabase-js serializer behaviour.** The `ArrayBuffer` versus `ArrayBufferView` asymmetry is undocumented behaviour that could change. The unit test asserting exact byte length is the guard.

## Implementation order

1. Migration: both tables, RLS policies, `compact_note`, realtime publication. Then `pnpm db:reset` and `pnpm db:types`.
2. `api/notes.ts` with zod boundaries, plus integration tests for RLS by impersonation.
3. `lib/note-doc.ts`: `Y.Doc` lifecycle, log apply, resync, compaction. Unit tests including the convergence property test.
4. Hooks, query keys, offline allowlist and mutation defaults registration.
5. Editor component with Tiptap plus collaboration. Two-tab convergence check.
6. `lib/awareness-channel.ts` plus carets. Late-joiner and disconnect tests.
7. Notes list, board tab, mobile navigation, source view.
8. E2E including the offline-both-edit case.
