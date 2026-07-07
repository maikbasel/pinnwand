// Dev-only fixture seeding. Creates three demo users + a shared board so a
// fresh stack is immediately usable without hand-adding accounts in Studio:
//
//   alice@dev.local    owner  of "Team-Board"       (shares with Bob)
//   bob@dev.local      member of "Team-Board"        (joined by code)
//   charlie@dev.local  owner  of "Charlies Board"    (his own)
//
// "Team-Board" is pre-filled with a few Aufgaben across the four columns so the
// board surface has something to render. Sign in at http://localhost:5173 by
// typing one of these addresses; the magic link / 6-digit OTP arrives in
// Mailpit (http://localhost:8025). No passwords: sign-in is magic-link + OTP.
//
// Runs as the `seed` service in docker-compose.yml ONLY. It is intentionally
// absent from docker-compose.coolify.yml, so prod has no fixture-seeding code
// path, and this file lives in scripts/ (never supabase/migrations/), so
// `supabase db push --include-all` can never apply it. The DEMO_ISSUER guard
// below is a third wall: it refuses to run against any non-demo service key.
//
// The script mirrors the real code paths the app and e2e suite use: users via
// the GoTrue admin API, boards via the `create_board` RPC, and the second
// membership via `join_board_by_code` (the genuine join flow), never
// RLS-bypassing service-role inserts. Idempotent: re-running against a seeded
// volume is a no-op.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://kong:8000";
const DEMO_ISSUER = "supabase-demo";
const LIST_USERS_PAGE_SIZE = 200;

const SHARED_BOARD_NAME = "Team-Board";
const SOLO_BOARD_NAME = "Charlies Board";

const OWNER = { email: "alice@dev.local", displayName: "Alice" };
const MEMBER = { email: "bob@dev.local", displayName: "Bob" };
const SOLO = { email: "charlie@dev.local", displayName: "Charlie" };

const log = (message) => process.stdout.write(`${message}\n`);

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`seed-dev: missing required env var ${name}`);
  }
  return value;
}

const SERVICE_ROLE_KEY = requireEnv("SERVICE_ROLE_KEY");
const ANON_KEY = requireEnv("ANON_KEY");

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anon = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// A user-scoped client so RPCs see the right `auth.uid()`. PostgREST reads the
// role from the forwarded Authorization JWT, not the anon apikey.
function userClient(accessToken) {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

function jwtIssuer(token) {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("seed-dev: SERVICE_ROLE_KEY is not a JWT");
  }
  const payload = JSON.parse(
    Buffer.from(parts[1], "base64url").toString("utf8")
  );
  return payload.iss;
}

// Belt-and-suspenders: even if this service is ever pointed at a real stack,
// refuse unless both the explicit dev flag and the public demo issuer are
// present. The compose service that runs this is itself dev-only.
function assertDemoStack() {
  if (process.env.SEED_DEV !== "true") {
    throw new Error('seed-dev: refusing to run: SEED_DEV is not "true"');
  }
  const issuer = jwtIssuer(SERVICE_ROLE_KEY);
  if (issuer !== DEMO_ISSUER) {
    throw new Error(
      `seed-dev: refusing to run: service-role key issuer is "${issuer}", expected "${DEMO_ISSUER}" (not a local demo stack)`
    );
  }
}

async function findUserByEmail(email) {
  let page = 1;
  let pageUsers = [];
  do {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: LIST_USERS_PAGE_SIZE,
    });
    if (error) {
      throw new Error(`seed-dev: listUsers failed: ${error.message}`);
    }
    pageUsers = data.users;
    const found = pageUsers.find((user) => user.email === email);
    if (found) {
      return found;
    }
    page += 1;
  } while (pageUsers.length === LIST_USERS_PAGE_SIZE);
  return null;
}

// Mint a session for an existing user without going through email. An admin
// magic-link token verified from Node (no PKCE verifier needed) yields the
// access token.
async function mintAccessToken(email) {
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkErr || !link.properties?.hashed_token) {
    throw new Error(
      `seed-dev: generateLink failed for ${email}: ${linkErr?.message ?? "no hashed_token"}`
    );
  }
  const { data, error: verifyErr } = await anon.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties.hashed_token,
  });
  if (verifyErr || !data.session) {
    throw new Error(
      `seed-dev: verifyOtp failed for ${email}: ${verifyErr?.message ?? "no session"}`
    );
  }
  return data.session.access_token;
}

async function ensureUser({ email, displayName }) {
  let user = await findUserByEmail(email);
  if (user) {
    log(`  user ${email} already exists`);
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    if (error || !data.user) {
      throw new Error(
        `seed-dev: createUser failed for ${email}: ${error?.message ?? "no user returned"}`
      );
    }
    user = data.user;
    log(`  created user ${email}`);
  }

  // `display_name` is the single source of truth for identity; the
  // handle_new_user trigger has already inserted the profile row.
  const { error: profileErr } = await admin
    .from("profiles")
    .update({ display_name: displayName })
    .eq("id", user.id);
  if (profileErr) {
    throw new Error(
      `seed-dev: profiles update failed for ${email}: ${profileErr.message}`
    );
  }

  const accessToken = await mintAccessToken(email);
  return { userId: user.id, accessToken };
}

// Create a board owned by `ownerClient`'s user via the real create_board RPC,
// or return the existing one (looked up by owner + name, admin-side to bypass
// RLS). Returns the board id + its join code.
async function ensureBoard(ownerClient, ownerId, name) {
  const { data: existing, error: selErr } = await admin
    .from("boards")
    .select("id, join_code")
    .eq("created_by", ownerId)
    .eq("name", name)
    .maybeSingle();
  if (selErr) {
    throw new Error(
      `seed-dev: board lookup failed (${name}): ${selErr.message}`
    );
  }
  if (existing) {
    log(`  board "${name}" already exists`);
    return { id: existing.id, joinCode: existing.join_code };
  }
  const { data: created, error: rpcErr } = await ownerClient.rpc(
    "create_board",
    { p_name: name }
  );
  if (rpcErr || !created) {
    throw new Error(
      `seed-dev: create_board failed (${name}): ${rpcErr?.message ?? "no row returned"}`
    );
  }
  log(`  created board "${name}"`);
  return { id: created.id, joinCode: created.join_code };
}

// Join `joinerClient`'s user to a board by its share code via the real
// join_board_by_code RPC. Skipped when already a member, so re-runs are no-ops.
async function ensureMembershipByCode(joinerClient, boardId, joinerId, code) {
  const { data: existing, error: selErr } = await admin
    .from("board_members")
    .select("user_id")
    .eq("board_id", boardId)
    .eq("user_id", joinerId)
    .maybeSingle();
  if (selErr) {
    throw new Error(`seed-dev: membership lookup failed: ${selErr.message}`);
  }
  if (existing) {
    log("  membership already present");
    return;
  }
  const { error: joinErr } = await joinerClient.rpc("join_board_by_code", {
    p_code: code,
  });
  if (joinErr) {
    throw new Error(`seed-dev: join_board_by_code failed: ${joinErr.message}`);
  }
  log("  joined member to shared board");
}

// A handful of Aufgaben across the four columns so the board renders with
// content. Assignees are a subset of {owner, member}. Skipped once the board
// already holds any task, so re-runs never duplicate.
async function ensureTasks(ownerClient, boardId, ownerId, memberId) {
  const { count, error: countErr } = await admin
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("board_id", boardId);
  if (countErr) {
    throw new Error(`seed-dev: task count failed: ${countErr.message}`);
  }
  if ((count ?? 0) > 0) {
    log("  board already has tasks");
    return;
  }

  const demoTasks = [
    {
      column: "in_bearbeitung",
      title: "Sprint-Planung vorbereiten",
      description: "Backlog sichten und die nächsten Aufgaben schätzen.",
      priority: "hoch",
      position: 0,
      assignees: [ownerId],
    },
    {
      column: "zu_erledigen",
      title: "Designs reviewen",
      description: "Feedback zu den neuen Board-Screens sammeln.",
      priority: "mittel",
      position: 0,
      assignees: [ownerId, memberId],
    },
    {
      column: "offen",
      title: "Onboarding-Doku schreiben",
      description: "Kurzanleitung für neue Team-Mitglieder.",
      priority: "niedrig",
      position: 0,
      assignees: [memberId],
    },
    {
      column: "erledigt",
      title: "Release 1.0 ausliefern",
      description: "Erste Version an das Team verteilt.",
      priority: "hoch",
      position: 0,
      assignees: [],
    },
  ];

  for (const task of demoTasks) {
    const { data: inserted, error: insErr } = await ownerClient
      .from("tasks")
      .insert({
        board_id: boardId,
        column: task.column,
        title: task.title,
        description: task.description,
        priority: task.priority,
        position: task.position,
        created_by: ownerId,
      })
      .select("id")
      .single();
    if (insErr || !inserted) {
      throw new Error(
        `seed-dev: task insert failed ("${task.title}"): ${insErr?.message ?? "no row"}`
      );
    }
    if (task.assignees.length > 0) {
      const { error: asgErr } = await ownerClient.from("task_assignees").insert(
        task.assignees.map((userId) => ({
          task_id: inserted.id,
          user_id: userId,
        }))
      );
      if (asgErr) {
        throw new Error(
          `seed-dev: assignee insert failed ("${task.title}"): ${asgErr.message}`
        );
      }
    }
  }
  log(`  seeded ${demoTasks.length} tasks into "${SHARED_BOARD_NAME}"`);
}

async function main() {
  assertDemoStack();
  log("seed-dev: provisioning demo users…");

  const owner = await ensureUser(OWNER);
  const member = await ensureUser(MEMBER);
  const solo = await ensureUser(SOLO);

  const ownerClient = userClient(owner.accessToken);
  const memberClient = userClient(member.accessToken);
  const soloClient = userClient(solo.accessToken);

  const shared = await ensureBoard(
    ownerClient,
    owner.userId,
    SHARED_BOARD_NAME
  );
  await ensureMembershipByCode(
    memberClient,
    shared.id,
    member.userId,
    shared.joinCode
  );
  await ensureTasks(ownerClient, shared.id, owner.userId, member.userId);
  await ensureBoard(soloClient, solo.userId, SOLO_BOARD_NAME);

  const vitePort = process.env.VITE_PORT ?? "5173";
  const mailpitPort = process.env.MAILPIT_UI_PORT ?? "8025";

  log("seed-dev: done.");
  log(
    `  ${OWNER.email}    owner  of "${SHARED_BOARD_NAME}" (code ${shared.joinCode})`
  );
  log(`  ${MEMBER.email}      member of "${SHARED_BOARD_NAME}"`);
  log(`  ${SOLO.email}  owner  of "${SOLO_BOARD_NAME}"`);
  log(
    `  Sign in at http://localhost:${vitePort}; magic link / OTP lands in Mailpit (http://localhost:${mailpitPort}).`
  );
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
