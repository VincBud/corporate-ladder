/**
 * Database security and constraint tests against the real migration, running
 * in PGlite (real Postgres). See server/testing/test-database.ts for what this
 * environment does and does not cover.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "./testing/test-database";

let t: TestDatabase;
let alice: string;
let bob: string;

beforeAll(async () => {
  t = await createTestDatabase();
  alice = await t.createUser("alice@example.com", "Alice Ledger");
  bob = await t.createUser("bob@example.com");
}, 60_000);

const denied = /permission denied|violates row-level security/;

describe("profiles", () => {
  it("creates a profile with a unique employee number for every new user", async () => {
    const { rows } = await t.admin.query<{ display_name: string; employee_number: string }>(
      "select display_name, employee_number from public.profiles order by employee_number",
    );
    expect(rows.map((r) => r.display_name)).toEqual(["Alice Ledger", "New Hire"]);
    expect(rows[0].employee_number).toMatch(/^CL-\d{6}$/);
    expect(new Set(rows.map((r) => r.employee_number)).size).toBe(2);
  });

  it("lets players read only their own profile", async () => {
    const rows = await t.asUser(alice, (db) => db.query("select user_id from public.profiles"));
    expect(rows.rows).toEqual([{ user_id: alice }]);
  });

  it("allows editing display name and department only", async () => {
    await t.asUser(alice, (db) => db.query("update public.profiles set display_name = 'Alice L.', department_id = 'finance' where user_id = $1", [alice]));
    const { rows } = await t.admin.query("select display_name, department_id from public.profiles where user_id = $1", [alice]);
    expect(rows[0]).toEqual({ display_name: "Alice L.", department_id: "finance" });

    await expect(t.asUser(alice, (db) => db.query("update public.profiles set employee_number = 'CL-000001'"))).rejects.toThrow(denied);
    await expect(t.asUser(alice, (db) => db.query("update public.profiles set user_id = $1", [bob]))).rejects.toThrow(denied);
  });

  it("cannot edit someone else's profile", async () => {
    await t.asUser(alice, (db) => db.query("update public.profiles set display_name = 'Hacked' where user_id = $1", [bob]));
    const { rows } = await t.admin.query("select display_name from public.profiles where user_id = $1", [bob]);
    expect(rows[0]).toEqual({ display_name: "New Hire" });
  });

  it("rejects invalid display names and departments", async () => {
    await expect(t.asUser(alice, (db) => db.query("update public.profiles set display_name = 'x' where user_id = $1", [alice]))).rejects.toThrow(/check/);
    await expect(
      t.asUser(alice, (db) => db.query("update public.profiles set department_id = 'nonexistent' where user_id = $1", [alice])),
    ).rejects.toThrow(/foreign key/);
  });

  it("sanitizes display names from sign-up metadata", async () => {
    const id = await t.createUser("weird@example.com", "\u0007");
    const { rows } = await t.admin.query("select display_name from public.profiles where user_id = $1", [id]);
    expect(rows[0]).toEqual({ display_name: "New Hire" });
  });
});

describe("client privileges", () => {
  it("hides game sessions (and their secret seeds) from players entirely", async () => {
    await expect(t.asUser(alice, (db) => db.query("select seed from public.game_sessions"))).rejects.toThrow(denied);
    await expect(t.asUser(alice, (db) => db.query("select id from public.game_sessions"))).rejects.toThrow(denied);
  });

  it("prevents players from writing results or XP directly", async () => {
    await expect(
      t.asUser(alice, (db) => db.query("insert into public.xp_ledger (user_id, source_type, source_id, amount) values ($1, 'game_result', gen_random_uuid(), 9999)", [alice])),
    ).rejects.toThrow(denied);
    await expect(t.asUser(alice, (db) => db.query("update public.game_results set xp_awarded = 9999"))).rejects.toThrow(denied);
    await expect(t.asUser(alice, (db) => db.query("delete from public.xp_ledger"))).rejects.toThrow(denied);
    await expect(t.asUser(alice, (db) => db.query("insert into public.legacy_practice_results (user_id, local_id, game_id, summary) values ($1, 'x', 'g', '{}')", [alice]))).rejects.toThrow(denied);
  });

  it("prevents players from calling trusted server functions", async () => {
    for (const call of [
      "select public.create_game_session($1, 'reconciliation-rush', 'RV1-0000000000000000')",
      "select public.finalize_game_session(gen_random_uuid(), $1, '{}'::jsonb, '{}'::jsonb)",
      "select public.record_game_hint(gen_random_uuid(), $1, 'error-1')",
      "select public.import_legacy_results($1, '[]'::jsonb)",
      "select public.get_game_session(gen_random_uuid(), $1)",
    ]) {
      await expect(t.asUser(alice, (db) => db.query(call, [alice])), call).rejects.toThrow(denied);
      await expect(t.asAnon((db) => db.query(call, [alice])), call).rejects.toThrow(denied);
    }
  });

  it("gives anonymous visitors only public reference data", async () => {
    const departments = await t.asAnon((db) => db.query("select id from public.departments"));
    expect(departments.rows.length).toBe(8);
    await expect(t.asAnon((db) => db.query("select * from public.profiles"))).rejects.toThrow(denied);
    await expect(t.asAnon((db) => db.query("select * from public.game_results"))).rejects.toThrow(denied);
  });
});

describe("ledger constraints", () => {
  it("awards XP for a source only once and never negative", async () => {
    const source = "00000000-0000-0000-0000-00000000abcd";
    await t.admin.query("insert into public.xp_ledger (user_id, source_type, source_id, amount) values ($1, 'game_result', $2, 10)", [alice, source]);
    await expect(
      t.admin.query("insert into public.xp_ledger (user_id, source_type, source_id, amount) values ($1, 'game_result', $2, 10)", [alice, source]),
    ).rejects.toThrow(/duplicate key/);
    await expect(
      t.admin.query("insert into public.xp_ledger (user_id, source_type, source_id, amount) values ($1, 'game_result', gen_random_uuid(), -5)", [alice]),
    ).rejects.toThrow(/check/);
    const xp = await t.asUser(alice, (db) => db.query<{ xp: number }>("select public.get_my_career_xp() as xp"));
    expect(xp.rows[0].xp).toBe(10);
    const bobXp = await t.asUser(bob, (db) => db.query<{ xp: number }>("select public.get_my_career_xp() as xp"));
    expect(bobXp.rows[0].xp).toBe(0);
    await t.admin.query("delete from public.xp_ledger where source_id = $1", [source]);
  });
});
