import { afterAll, describe, expect, it } from "vitest";
import {
  asService,
  createAuthUser,
  teardownPool,
  withRls,
} from "@/test/with-rls";

type ProfileRow = { id: string; display_name: string };

afterAll(async () => {
  await teardownPool();
});

describe("handle_new_user trigger", () => {
  it("seeds a profiles row with the email local-part as display name", async () => {
    const email = `trig-${Date.now()}@test.local`;
    const userId = await createAuthUser(email);

    const rows = await asService(
      (sql) =>
        sql<ProfileRow[]> /* sql */`
          select id, display_name from public.profiles where id = ${userId}
        `
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: userId,
      display_name: email.split("@")[0],
    });
  });
});

describe("profiles RLS", () => {
  it("lets a user read their own profile", async () => {
    const userId = await createAuthUser(`self-${Date.now()}@test.local`);
    const rows = await withRls(
      userId,
      (sql) =>
        sql<{ id: string }[]> /* sql */`
          select id from public.profiles where id = ${userId}
        `
    );
    expect(rows).toEqual([{ id: userId }]);
  });

  it("hides an unrelated user's profile", async () => {
    const a = await createAuthUser(`iso-a-${Date.now()}@test.local`);
    const b = await createAuthUser(`iso-b-${Date.now()}@test.local`);
    const rows = await withRls(
      a,
      (sql) =>
        sql<{ id: string }[]> /* sql */`
          select id from public.profiles where id = ${b}
        `
    );
    expect(rows).toEqual([]);
  });

  it("lets a user update only their own display name", async () => {
    const a = await createAuthUser(`upd-a-${Date.now()}@test.local`);
    const b = await createAuthUser(`upd-b-${Date.now()}@test.local`);

    await withRls(a, async (sql) => {
      await sql /* sql */`
        update public.profiles set display_name = 'Alice' where id = ${a}
      `;
    });
    // The update targets B but RLS's WITH CHECK / USING scopes it to auth.uid(),
    // so zero rows change and B stays as seeded.
    await withRls(a, async (sql) => {
      await sql /* sql */`
        update public.profiles set display_name = 'Hacked' where id = ${b}
      `;
    });

    const rows = await asService(
      (sql) =>
        sql<ProfileRow[]> /* sql */`
          select id, display_name from public.profiles where id in (${a}, ${b})
        `
    );
    const byId = new Map(rows.map((r) => [r.id, r.display_name]));
    expect(byId.get(a)).toBe("Alice");
    expect(byId.get(b)).not.toBe("Hacked");
  });
});
