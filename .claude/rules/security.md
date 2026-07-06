# Security

Safety-critical — loaded every session.

## Supabase / RLS (non-negotiable)

- **RLS is enabled on every table.** Every migration that creates a table must enable RLS in the same migration and add policies before any data flows.
- **`auth.uid()` is used in every policy.** No policy may grant access without filtering by the authenticated user.
- **Sharing is via the `board_members` table.** A user sees a board's data only if a row in `board_members` links them to the board. Never expose another user's tasks. Membership checks go through the SECURITY DEFINER helpers `is_board_member(board_id)` / `is_board_owner(board_id)` to avoid policy recursion.
- **Joining is by share code.** Membership is minted by the `join_board_by_code` RPC (SECURITY DEFINER); the client never `INSERT`s into `board_members` directly. Renaming/deleting a board and rotating its join code are owner-only (`is_board_owner`). RLS is the authz boundary: never rely on a UI gate alone.
- **The service role key never reaches the client.** Only the anon key is in `import.meta.env.VITE_*`. The service role key, if used at all, lives server-side (Edge Functions / scripts) and never in the React bundle.
- **Verify RLS by impersonation before merging:** sign in as user A, attempt to read user B's plan — must return empty. Encode this as a Vitest or Playwright check, not a manual checklist.

## Input validation

- **Validate at every API boundary with `zod`.** Untrusted input includes: form values, URL params, query string, realtime payloads, function responses parsed into typed shapes.
- **Never trust generated types alone.** `database.ts` reflects the schema, not what actually arrived in this request.

## Web

- **`rel="noopener noreferrer"`** is required on every `target="_blank"` link.
- **Avoid `dangerouslySetInnerHTML`.** If a feature requires it, the input must be sanitized through a vetted library (`DOMPurify`) and the source documented inline.
- **No `eval`, no `Function(...)`, no direct `document.cookie` writes.** Cookies for auth are managed by Supabase Auth — don't touch them.
- **No secrets in the client bundle.** Anything checked into git or built into `dist/` is public. `.env` is reference-only and never committed.
