/**
 * Privilege allowlist and integrity guards, against the real migrations in
 * PGlite with Supabase-style default privileges (everything granted to
 * anon, authenticated and service_role unless a migration revokes it).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { cellKey } from "@/games/spreadsheet-wars/sheet";
import { createRpcRoundStore } from "./rounds/round-store";
import { challengeFor } from "./rounds/rules";
import { createVerifiedRoundService, type VerifiedRoundService } from "./rounds/service";
import { createTestDatabase, type TestDatabase } from "./testing/test-database";

const ROLES = ["anon", "authenticated", "service_role"] as const;
const WRITE_PRIVILEGES = ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];
const denied = /permission denied/;

let t: TestDatabase;
let rounds: VerifiedRoundService;
let seedCounter = 0;

beforeAll(async () => {
  t = await createTestDatabase();
  rounds = createVerifiedRoundService({
    store: createRpcRoundStore(t.serviceRpc),
    createSeed: () => `RV1-security-${String(++seedCounter).padStart(8, "0")}-seed`,
  });
}, 60_000);

async function play(userId: string) {
  const started = await rounds.startRound(userId);
  const { rows } = await t.admin.query<{ seed: string }>("select seed from public.game_sessions where id = $1", [started.sessionId]);
  const challenge = challengeFor(1, rows[0].seed);
  const entries = Object.fromEntries(challenge.errors.map((e) => [cellKey(e.address), challenge.cells.get(cellKey(e.address))!.solution]));
  await rounds.submitRound(userId, started.sessionId, { entries });
  return started.sessionId;
}

async function asServiceRole(sql: string, params: unknown[] = []) {
  await t.db.exec("set role service_role");
  try {
    return await t.db.query(sql, params);
  } finally {
    await t.db.exec("reset role");
  }
}

async function integrity() {
  return (await t.serviceRpc("check_progression_integrity", {})) as Record<string, number>;
}

describe("privilege allowlist", () => {
  it("grants no write privileges beyond the allowlist, on any table or column", async () => {
    const { rows: tables } = await t.admin.query<{ name: string }>(
      "select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1",
    );
    const found: string[] = [];
    for (const role of ROLES) {
      for (const { name } of tables) {
        for (const privilege of WRITE_PRIVILEGES) {
          const { rows } = await t.admin.query<{ ok: boolean }>("select has_table_privilege($1, $2, $3) as ok", [role, `public.${name}`, privilege]);
          if (rows[0].ok) found.push(`${role}:${name}:${privilege}`);
        }
        const { rows: columns } = await t.admin.query<{ column: string; privilege: string }>(
          `select a.attname as column, p.privilege from pg_attribute a cross join (values ('INSERT'), ('UPDATE'), ('REFERENCES')) p(privilege)
            where a.attrelid = $2::regclass and a.attnum > 0 and not a.attisdropped
              and has_column_privilege($1, $2::regclass, a.attnum, p.privilege)
              and not has_table_privilege($1, $2::regclass, p.privilege)`,
          [role, `public.${name}`],
        );
        for (const c of columns) found.push(`${role}:${name}.${c.column}:${c.privilege}`);
      }
    }
    expect(found.sort()).toEqual(
      [
        "authenticated:profiles.display_name:UPDATE",
        "service_role:game_sessions.deadline_at:UPDATE",
        "service_role:game_sessions.started_at:UPDATE",
        "service_role:profiles.display_name:UPDATE",
      ].sort(),
    );
  });

  it("limits reads to the intended tables", async () => {
    const readable = async (role: string) => {
      const { rows } = await t.admin.query<{ name: string }>(
        `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r' and has_table_privilege($1, c.oid, 'SELECT') order by 1`,
        [role],
      );
      return rows.map((r) => r.name);
    };
    const reference = ["achievement_definitions", "contribution_allocations", "contribution_formulas", "daily_assignments", "departments", "game_rules"];
    expect(await readable("anon")).toEqual(reference);
    expect(await readable("authenticated")).toEqual(
      [...reference, "daily_challenge_attempts", "department_memberships", "game_results", "legacy_practice_results", "player_achievements", "profiles", "xp_ledger"].sort(),
    );
    expect(await readable("service_role")).toEqual(
      // Never daily_challenges: its seeds are read only through get_game_session.
      [...reference, "contribution_events", "daily_challenge_attempts", "department_memberships", "game_results", "game_sessions", "legacy_practice_results", "player_achievements", "profiles", "xp_ledger"].sort(),
    );
  });

  it("allows only the intended functions per role", async () => {
    const executable = async (role: string) => {
      const { rows } = await t.admin.query<{ name: string }>(
        `select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and has_function_privilege($1, p.oid, 'EXECUTE') order by 1`,
        [role],
      );
      return rows.map((r) => r.name);
    };
    expect(await executable("anon")).toEqual([]);
    expect(await executable("authenticated")).toEqual(["get_my_career_xp"]);
    expect(await executable("service_role")).toEqual([
      "award_achievements",
      "backfill_contribution_events",
      "check_progression_integrity",
      "create_game_session",
      "finalize_game_session",
      "get_achievement_facts",
      "get_active_daily_session",
      "get_company_quarter",
      "get_daily_leaderboard",
      "get_daily_status",
      "get_game_session",
      "get_my_career_xp",
      "import_legacy_results",
      "record_game_hint",
      "select_department",
      "start_daily_attempt",
      "utc_quarter",
    ]);
  });

  it("gives no role access to sequences", async () => {
    const { rows } = await t.admin.query<{ grants: string | null }>(
      `select string_agg(r || ':' || c.relname, ',') as grants
         from pg_class c join pg_namespace n on n.oid = c.relnamespace, unnest(array['anon', 'authenticated', 'service_role']) r
        where n.nspname = 'public' and c.relkind = 'S'
          and (has_sequence_privilege(r, c.oid, 'USAGE') or has_sequence_privilege(r, c.oid, 'UPDATE'))`,
    );
    expect(rows[0].grants).toBeNull();
  });
});

describe("service role", () => {
  let player: string;
  let sessionId: string;
  beforeAll(async () => {
    player = await t.createUser("svc-target@example.com");
    sessionId = await play(player);
  });

  it.each([
    ["update a verified score", "update public.game_results set score = 1050"],
    ["delete verified results", "delete from public.game_results"],
    ["insert a result", "insert into public.game_results (session_id) values (gen_random_uuid())"],
    ["grant itself XP", "insert into public.xp_ledger (user_id, source_type, source_id, amount) select user_id, 'game_result', gen_random_uuid(), 999 from public.profiles limit 1"],
    ["change XP", "update public.xp_ledger set amount = 999"],
    ["delete XP", "delete from public.xp_ledger"],
    ["truncate XP", "truncate public.xp_ledger"],
    ["delete sessions", "delete from public.game_sessions"],
    ["finalize a session by hand", "update public.game_sessions set status = 'finalized'"],
    ["swap a seed", "update public.game_sessions set seed = 'RV1-forged-seed-value'"],
    ["create a session", "insert into public.game_sessions (user_id, game_id, rules_version, seed, deadline_at) select user_id, 'reconciliation-rush', 1, 'RV1-forged-seed-1234', now() from public.profiles limit 1"],
    ["change an employee number", "update public.profiles set employee_number = 'CL-000001'"],
    ["delete profiles", "delete from public.profiles"],
    ["write legacy imports", "insert into public.legacy_practice_results (user_id, local_id, game_id, summary) select user_id, 'x', 'g', '{}' from public.profiles limit 1"],
    ["change game rules", "update public.game_rules set xp_score_divisor = 1"],
    ["add departments", "insert into public.departments (id, name) values ('shadow', 'Shadow')"],
    ["add a trigger", "create trigger evil before insert on public.xp_ledger for each row execute function public.touch_updated_at()"],
    ["call a trigger function", "select public.handle_new_user()"],
  ])("can't %s", async (_, sql) => {
    await expect(asServiceRole(sql)).rejects.toThrow(/permission denied|must be owner/);
  });

  it("can still move the clock of an active round, but not of a closed one", async () => {
    const started = await rounds.startRound(player);
    await asServiceRole("update public.game_sessions set started_at = now() - interval '10 seconds', deadline_at = now() + interval '80 seconds' where id = $1", [started.sessionId]);
    await expect(asServiceRole("update public.game_sessions set deadline_at = now() + interval '1 day' where id = $1", [sessionId])).rejects.toThrow(/game_session_closed/);
  });

  it("can read what the server needs", async () => {
    const { rows } = await asServiceRole("select (select count(*)::int from public.game_results) as results, (select count(*)::int from public.contribution_events) as events");
    expect(rows[0]).toEqual({ results: 1, events: 1 });
  });
});

describe("owner-level guards", () => {
  it.each([
    ["update a verified result", "update public.game_results set score = 0", /game_results_append_only/],
    ["delete a verified result", "delete from public.game_results", /game_results_append_only/],
    ["truncate verified results", "truncate public.game_results cascade", /append_only/],
    ["update XP", "update public.xp_ledger set amount = 0", /xp_ledger_append_only/],
    ["delete XP", "delete from public.xp_ledger", /xp_ledger_append_only/],
    ["delete a session", "delete from public.game_sessions", /game_sessions_delete_forbidden/],
    ["reopen a finalized session", "update public.game_sessions set status = 'active', finalized_at = null where status = 'finalized'", /game_session_closed/],
  ])("block even the database owner trying to %s", async (_, sql, error) => {
    await expect(t.admin.query(sql)).rejects.toThrow(error);
  });
});

describe("account deletion and integrity", () => {
  it("reports no integrity problems after normal play", async () => {
    const a = await t.createUser("integrity-a@example.com");
    await play(a);
    await play(a);
    expect(Object.values(await integrity()).every((n) => n === 0)).toBe(true);
  });

  it("deletes a player's sessions, results, XP, events and imports together", async () => {
    const leaver = await t.createUser("leaver@example.com");
    await play(leaver);
    await t.serviceRpc("import_legacy_results", { p_user_id: leaver, p_records: [{ id: "local-1", gameId: "reconciliation-rush" }] });
    await t.admin.query("delete from auth.users where id = $1", [leaver]);
    const { rows } = await t.admin.query(
      `select (select count(*)::int from public.game_sessions where user_id = $1) as sessions,
              (select count(*)::int from public.game_results where user_id = $1) as results,
              (select count(*)::int from public.xp_ledger where user_id = $1) as xp,
              (select count(*)::int from public.contribution_events where user_id = $1) as events,
              (select count(*)::int from public.legacy_practice_results where user_id = $1) as imports`,
      [leaver],
    );
    expect(rows[0]).toEqual({ sessions: 0, results: 0, xp: 0, events: 0, imports: 0 });
    expect(Object.values(await integrity()).every((n) => n === 0)).toBe(true);
  });

  it("also cascades consistently when only the profile is deleted", async () => {
    const leaver = await t.createUser("profile-only@example.com");
    await play(leaver);
    await t.admin.query("delete from public.profiles where user_id = $1", [leaver]);
    expect(Object.values(await integrity()).every((n) => n === 0)).toBe(true);
  });

  it("detects orphaned and contradictory records arranged behind the guards' back", async () => {
    const player = await t.createUser("broken@example.com");
    const sessionId = await play(player);
    await t.arrange("insert into public.xp_ledger (user_id, source_type, source_id, amount) values ($1, 'game_result', gen_random_uuid(), 5)", [player]);
    await t.arrange("update public.xp_ledger set amount = amount + 1 where source_id = $1", [sessionId]);
    expect(await integrity()).toMatchObject({ xp_without_result: 1, xp_amount_mismatch: 1 });
    await t.arrange("delete from public.xp_ledger where user_id = $1", [player]);
    expect(await integrity()).toMatchObject({ results_without_xp: 1, xp_without_result: 0 });
    await t.arrange("delete from public.game_results where user_id = $1", [player]);
    expect(await integrity()).toMatchObject({ finalized_sessions_without_result: 1 });
    // Remove the broken player so later checks start clean.
    await t.admin.query("delete from auth.users where id = $1", [player]);
    expect(Object.values(await integrity()).every((n) => n === 0)).toBe(true);
  });

  it("keeps the integrity audit away from players", async () => {
    const player = await t.createUser("audit@example.com");
    await expect(t.asUser(player, (db) => db.query("select public.check_progression_integrity()"))).rejects.toThrow(denied);
    await expect(t.asAnon((db) => db.query("select public.check_progression_integrity()"))).rejects.toThrow(denied);
  });
});
