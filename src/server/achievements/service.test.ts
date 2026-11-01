/**
 * Achievements against the real migrations in PGlite: registry/database
 * consistency, unlocks from verified rounds, exactly-once awards (retries and
 * concurrent syncs), backfill of earlier history, department careers,
 * award validation, RLS, direct writes and account deletion.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { ACHIEVEMENTS } from "@/career/achievements";
import { cellKey } from "@/games/spreadsheet-wars/sheet";
import { selectDepartment } from "../departments/service";
import { createRpcRoundStore } from "../rounds/round-store";
import { challengeFor } from "../rounds/rules";
import { createVerifiedRoundService, type VerifiedRoundService } from "../rounds/service";
import { createTestDatabase, type TestDatabase } from "../testing/test-database";
import { syncAchievements } from "./service";

const denied = /permission denied/;
let t: TestDatabase;
let rounds: VerifiedRoundService;
let seedCounter = 0;

beforeAll(async () => {
  t = await createTestDatabase();
  rounds = createVerifiedRoundService({
    store: createRpcRoundStore(t.serviceRpc),
    createSeed: () => `RV1-ach-${String(++seedCounter).padStart(8, "0")}-seed`,
  });
}, 60_000);

async function play(userId: string, fixed = 5) {
  const started = await rounds.startRound(userId);
  const { rows } = await t.admin.query<{ seed: string }>("select seed from public.game_sessions where id = $1", [started.sessionId]);
  const challenge = challengeFor(1, rows[0].seed);
  const entries = Object.fromEntries(challenge.errors.slice(0, fixed).map((e) => [cellKey(e.address), challenge.cells.get(cellKey(e.address))!.solution]));
  const result = await rounds.submitRound(userId, started.sessionId, { entries });
  return { ...result, sessionId: started.sessionId };
}

async function stored(userId: string) {
  const { rows } = await t.admin.query<{ achievement_id: string; unlocked_at: Date; source_type: string | null; source_id: string | null }>(
    "select achievement_id, unlocked_at, source_type, source_id from public.player_achievements where user_id = $1 order by achievement_id",
    [userId],
  );
  return rows;
}

// An instant, all-fixed, unassisted round: perfect and well ahead of the clock. Every verified round also records a contribution event.
const PERFECT_ROUND = ["ahead-of-schedule", "clean-audit", "first-assignment", "no-assistance-required", "team-player"];
const award = (userId: string, awards: unknown[]) => t.serviceRpc("award_achievements", { p_user_id: userId, p_awards: awards });

describe("registry and database", () => {
  it("defines the same achievements, categories, rarities and statuses in TypeScript and the database", async () => {
    const { rows } = await t.admin.query<{ id: string; category: string; rarity: string; status: string }>(
      "select id, category, rarity, status from public.achievement_definitions order by id",
    );
    const expected = ACHIEVEMENTS.map(({ id, category, rarity, status }) => ({ id, category, rarity, status })).sort((a, b) => a.id.localeCompare(b.id));
    expect(rows).toEqual(expected);
  });

  it("keeps definitions immutable except for their status", async () => {
    await expect(t.admin.query("update public.achievement_definitions set rarity = 'common' where id = 'corporate-veteran'")).rejects.toThrow(/achievement_definitions_immutable/);
    await expect(t.admin.query("delete from public.achievement_definitions where id = 'daily-grind'")).rejects.toThrow(/achievement_definitions_immutable/);
    await t.admin.query("update public.achievement_definitions set status = status where id = 'daily-grind'");
  });
});

describe("unlocking from verified play", () => {
  it("awards nothing to a player without verified history", async () => {
    const newbie = await t.createUser("ach-newbie@example.com");
    const sync = await syncAchievements(t.serviceRpc, newbie);
    expect(sync.created).toEqual([]);
    expect(sync.summary.unlocked).toEqual([]);
    expect(sync.summary.progress["getting-started"]).toEqual({ current: 0, target: 10 });
    expect(await stored(newbie)).toEqual([]);
  });

  it("unlocks from a verified round, citing the result and its database timestamp", async () => {
    const ada = await t.createUser("ach-ada@example.com");
    const round = await play(ada, 5);
    const sync = await syncAchievements(t.serviceRpc, ada);
    expect(sync.created.map((u) => u.id).sort()).toEqual(PERFECT_ROUND);
    const rows = await stored(ada);
    expect(rows.map((r) => r.achievement_id)).toEqual(PERFECT_ROUND);
    for (const row of rows) {
      const type = row.achievement_id === "team-player" ? "contribution_event" : "game_result";
      expect(row).toMatchObject({ source_type: type, source_id: round.sessionId });
      if (type === "game_result") expect(row.unlocked_at.toISOString()).toBe(round.record.completedAt);
    }
    expect(sync.summary.progress["getting-started"]).toEqual({ current: 1, target: 10 });
  });

  it("awards exactly once: retries create nothing and keep the original unlock", async () => {
    const bea = await t.createUser("ach-bea@example.com");
    await play(bea, 3);
    const first = await syncAchievements(t.serviceRpc, bea);
    expect(first.created.map((u) => u.id).sort()).toEqual(["first-assignment", "team-player"]);
    const again = await syncAchievements(t.serviceRpc, bea);
    expect(again.created).toEqual([]);
    expect(again.summary.unlocked).toEqual(first.summary.unlocked);
    // A raw re-award of an existing unlock is a no-op too.
    const raw = (await award(bea, [{ achievement_id: "first-assignment", achieved_at: new Date().toISOString() }])) as { created: unknown[] };
    expect(raw.created).toEqual([]);
    expect((await stored(bea)).length).toBe(2);
  });

  it("awards exactly once under concurrent syncs", async () => {
    const cal = await t.createUser("ach-cal@example.com");
    await play(cal, 5);
    const syncs = await Promise.all(Array.from({ length: 6 }, () => syncAchievements(t.serviceRpc, cal)));
    const created = syncs.flatMap((s) => s.created.map((u) => u.id)).sort();
    expect(created).toEqual(PERFECT_ROUND);
    expect((await stored(cal)).map((r) => r.achievement_id)).toEqual(PERFECT_ROUND);
  });

  it("backfills history earned before achievements existed, with the original dates", async () => {
    const dee = await t.createUser("ach-dee@example.com");
    for (let i = 0; i < 10; i++) await play(dee, 2);
    await t.arrange("update public.game_results set completed_at = completed_at - interval '40 days' where user_id = $1", [dee]);
    await t.arrange("update public.contribution_events set completed_at = completed_at - interval '40 days' where user_id = $1", [dee]);
    expect(await stored(dee)).toEqual([]);
    const sync = await syncAchievements(t.serviceRpc, dee);
    expect(sync.created.map((u) => u.id).sort()).toEqual(["first-assignment", "getting-started", "team-player"]);
    for (const row of await stored(dee)) expect(Date.now() - row.unlocked_at.getTime()).toBeGreaterThan(39 * 86_400_000);
    expect((await syncAchievements(t.serviceRpc, dee)).created).toEqual([]);
  });
});

describe("department careers", () => {
  it("unlocks Welcome Aboard from the membership and promotions from qualifying rounds", async () => {
    const eve = await t.createUser("ach-eve@example.com");
    const joined = await selectDepartment(t.serviceRpc, eve, { departmentId: "controlling", requestId: crypto.randomUUID() });
    const welcome = await syncAchievements(t.serviceRpc, eve);
    expect(welcome.created.map((u) => u.id)).toEqual(["welcome-aboard"]);
    expect((await stored(eve))[0]).toMatchObject({ source_type: "department_membership", source_id: joined.membership.id });

    for (let i = 0; i < 3; i++) await play(eve, 5);
    const promoted = await syncAchievements(t.serviceRpc, eve);
    expect(promoted.created.map((u) => u.id)).toContain("climbing-the-ladder");
    expect(promoted.summary.progress["middle-management"]).toEqual({ current: 3, target: 10 });
  });
});

describe("company participation", () => {
  it("unlocks Team Player from the verified contribution event", async () => {
    const fay = await t.createUser("ach-fay@example.com");
    await selectDepartment(t.serviceRpc, fay, { departmentId: "finance", requestId: crypto.randomUUID() });
    const round = await play(fay, 4);
    await syncAchievements(t.serviceRpc, fay);
    const team = (await stored(fay)).find((r) => r.achievement_id === "team-player");
    expect(team).toMatchObject({ source_type: "contribution_event", source_id: round.sessionId });
    expect((await syncAchievements(t.serviceRpc, fay)).summary.progress["quarterly-contributor"]).toEqual({ current: 1, target: 2 });
  });
});

describe("award validation", () => {
  it("rejects future, unknown and malformed awards", async () => {
    const gil = await t.createUser("ach-gil@example.com");
    for (const bad of [
      [{ achievement_id: "daily-grind" }],
      [{ achievement_id: "not-a-thing" }],
      [{ achievement_id: "first-assignment", source_type: "game_result" }],
      Array.from({ length: 51 }, () => ({ achievement_id: "first-assignment" })),
    ]) {
      await expect(award(gil, bad)).rejects.toThrow(/invalid_achievement_award/);
    }
    await expect(award(crypto.randomUUID(), [])).rejects.toThrow(/unknown_player/);
    expect(await stored(gil)).toEqual([]);
  });

  it("rejects sources that belong to another player", async () => {
    const owner = await t.createUser("ach-owner@example.com");
    const thief = await t.createUser("ach-thief@example.com");
    const round = await play(owner, 5);
    await expect(award(thief, [{ achievement_id: "clean-audit", source_type: "game_result", source_id: round.sessionId }])).rejects.toThrow(/invalid_achievement_award/);
    await expect(award(thief, [{ achievement_id: "clean-audit", source_type: "game_result", source_id: "x'; drop table--" }])).rejects.toThrow(/invalid_achievement_award/);
    expect(await stored(thief)).toEqual([]);
  });

  it("never dates an unlock in the future", async () => {
    const hal = await t.createUser("ach-hal@example.com");
    await award(hal, [{ achievement_id: "first-assignment", achieved_at: "2099-01-01T00:00:00Z" }]);
    expect((await stored(hal))[0].unlocked_at.getTime()).toBeLessThanOrEqual(Date.now());
  });
});

describe("access control", () => {
  it("lets players read only their own unlocks", async () => {
    const ivy = await t.createUser("ach-ivy@example.com");
    const jon = await t.createUser("ach-jon@example.com");
    await play(ivy, 3);
    await syncAchievements(t.serviceRpc, ivy);
    const own = await t.asUser(ivy, (db) => db.query("select achievement_id from public.player_achievements"));
    expect(own.rows.map((r) => (r as { achievement_id: string }).achievement_id).sort()).toEqual(["first-assignment", "team-player"]);
    const other = await t.asUser(jon, (db) => db.query("select * from public.player_achievements where user_id = $1", [ivy]));
    expect(other.rows).toEqual([]);
    await expect(t.asAnon((db) => db.query("select * from public.player_achievements"))).rejects.toThrow(denied);
    const definitions = await t.asAnon((db) => db.query("select id from public.achievement_definitions"));
    expect(definitions.rows.length).toBe(ACHIEVEMENTS.length);
  });

  it("denies direct writes and RPC calls to players and visitors", async () => {
    const kim = await t.createUser("ach-kim@example.com");
    const insert = "insert into public.player_achievements (user_id, achievement_id, unlocked_at) values ($1, 'corporate-veteran', now())";
    await expect(t.asUser(kim, (db) => db.query(insert, [kim]))).rejects.toThrow(denied);
    await expect(t.asAnon((db) => db.query(insert, [kim]))).rejects.toThrow(denied);
    await expect(t.asUser(kim, (db) => db.query("select public.award_achievements($1, '[{\"achievement_id\":\"corporate-veteran\"}]'::jsonb)", [kim]))).rejects.toThrow(denied);
    await expect(t.asUser(kim, (db) => db.query("select public.get_achievement_facts($1)", [kim]))).rejects.toThrow(denied);
    await expect(t.asUser(kim, (db) => db.query("update public.achievement_definitions set status = 'available' where id = 'daily-grind'"))).rejects.toThrow(denied);
    // Even the trusted server writes only through award_achievements.
    await t.db.exec("set role service_role");
    try {
      await expect(t.db.query(insert, [kim])).rejects.toThrow(denied);
    } finally {
      await t.db.exec("reset role");
    }
    expect(await stored(kim)).toEqual([]);
  });

  it("keeps unlocks append-only, even for the table owner", async () => {
    const lou = await t.createUser("ach-lou@example.com");
    await award(lou, [{ achievement_id: "first-assignment" }]);
    await expect(t.admin.query("update public.player_achievements set unlocked_at = now() - interval '1 year' where user_id = $1", [lou])).rejects.toThrow(/append_only/);
    await expect(t.admin.query("delete from public.player_achievements where user_id = $1", [lou])).rejects.toThrow(/append_only/);
    await expect(t.admin.query("truncate public.player_achievements")).rejects.toThrow(/append_only/);
  });

  it("removes unlocks with the player's account", async () => {
    const max = await t.createUser("ach-max@example.com");
    await play(max, 5);
    await syncAchievements(t.serviceRpc, max);
    expect((await stored(max)).length).toBeGreaterThan(0);
    await t.admin.query("delete from auth.users where id = $1", [max]);
    expect(await stored(max)).toEqual([]);
  });
});
