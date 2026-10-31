/**
 * Verified company contributions: the real migrations in PGlite (real
 * Postgres), driven through the same service and RPC adapter as production.
 * See server/testing/test-database.ts for what this environment covers.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { xpForScore } from "@/career/xp";
import { CANONICAL_DEPARTMENTS } from "@/config/departments";
import { cellKey } from "@/games/spreadsheet-wars/sheet";
import { CONTRIBUTION_RULES, aggregatePeriod, normalizeEvent } from "@/simulation/contribution";
import { METRICS, getMetric } from "@/simulation/departments";
import { LIVE_GAME_RULES, RECONCILIATION_RUSH_RULE } from "@/simulation/games";
import { periodOf } from "@/simulation/periods";
import { contributionEventFromRow, contributionEventFromVerifiedResult, type ContributionEventRow } from "@/simulation/source";
import { DEPARTMENT_IDS } from "@/simulation/types";
import { createRpcRoundStore, type RoundStore } from "./rounds/round-store";
import { challengeFor } from "./rounds/rules";
import { createVerifiedRoundService, resultRowToRecord, type VerifiedRoundService } from "./rounds/service";
import { createTestDatabase, type TestDatabase } from "./testing/test-database";

const denied = /permission denied|violates row-level security/;
let seedCounter = 0;
const nextSeed = () => `RV1-contrib-${String(++seedCounter).padStart(8, "0")}-seed`;

interface Harness {
  t: TestDatabase;
  store: RoundStore;
  service: VerifiedRoundService;
}

async function harness(): Promise<Harness> {
  const t = await createTestDatabase();
  const store = createRpcRoundStore(t.serviceRpc);
  return { t, store, service: createVerifiedRoundService({ store, createSeed: nextSeed }) };
}

async function playRound(h: Harness, userId: string, fixed = 5) {
  const response = await h.service.startRound(userId);
  const session = await h.store.getSession(response.sessionId, userId);
  const challenge = challengeFor(1, session!.seed);
  const entries = Object.fromEntries(
    challenge.errors.slice(0, fixed).map((e) => [cellKey(e.address), challenge.cells.get(cellKey(e.address))!.solution]),
  );
  return { sessionId: response.sessionId, seed: session!.seed, entries };
}

async function eventsFor(h: Harness, userId: string): Promise<ContributionEventRow[]> {
  const { rows } = await h.t.admin.query<ContributionEventRow>(
    "select * from public.contribution_events where user_id = $1 order by completed_at, session_id",
    [userId],
  );
  return rows;
}

async function counts(h: Harness, userId: string) {
  const { rows } = await h.t.admin.query<{ results: number; xp_rows: number; events: number }>(
    `select (select count(*)::int from public.game_results where user_id = $1) as results,
            (select count(*)::int from public.xp_ledger where user_id = $1) as xp_rows,
            (select count(*)::int from public.contribution_events where user_id = $1) as events`,
    [userId],
  );
  return rows[0];
}

const finalizeArgs = (sessionId: string, userId: string) => ({
  p_session_id: sessionId,
  p_user_id: userId,
  p_result: {
    department: "IT", difficulty: "associate", completion: "submitted", score: 600, max_score: 1050, grade: "Meets Expectations",
    errors_fixed: 4, total_errors: 5, incorrect_corrections: 1, accuracy: 0.8, time_used_ms: 30_000, time_remaining_ms: 60_000,
  },
  p_submission: {},
});

describe("canonical departments", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
  }, 60_000);

  it("match the database after all migrations", async () => {
    const { rows } = await h.t.admin.query("select id, name, kind from public.departments order by id");
    expect(rows).toEqual([...CANONICAL_DEPARTMENTS].sort((a, b) => a.id.localeCompare(b.id)));
  });

  it("use the canonical ids for every simulation department and metric", () => {
    const operating = CANONICAL_DEPARTMENTS.filter((d) => d.kind === "operating").map((d) => d.id);
    expect([...DEPARTMENT_IDS].sort()).toEqual(operating.sort());
    expect(METRICS.every((m) => operating.includes(m.departmentId))).toBe(true);
  });

  it("keep existing profile assignments valid", async () => {
    const user = await h.t.createUser("legacy-dept@example.com");
    for (const id of ["people", "it", "legal", "strategy", "controlling"]) {
      await h.t.asUser(user, (db) => db.query("update public.profiles set department_id = $1 where user_id = $2", [id, user]));
    }
    const { rows } = await h.t.admin.query("select department_id from public.profiles where user_id = $1", [user]);
    expect(rows[0]).toEqual({ department_id: "controlling" });
  });
});

describe("contribution formulas", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
  }, 60_000);

  it("allocate Reconciliation Rush 70% to Controlling's Ledger integrity and 30% to Finance's Close quality", async () => {
    const { rows } = await h.t.asAnon((db) =>
      db.query("select metric_id, department_id, weight_bp from public.contribution_allocations where game_id = 'reconciliation-rush' and formula_version = 1 order by metric_id"),
    );
    expect(rows).toEqual([
      { metric_id: "close-quality", department_id: "finance", weight_bp: 3000 },
      { metric_id: "ledger-integrity", department_id: "controlling", weight_bp: 7000 },
    ]);
  });

  it("match the TypeScript rules for every live game", async () => {
    for (const rule of LIVE_GAME_RULES) {
      const { rows } = await h.t.admin.query<{ metric_id: string; department_id: string; weight_bp: number }>(
        `select a.metric_id, a.department_id, a.weight_bp from public.contribution_allocations a
           join public.contribution_formulas f using (game_id, formula_version)
          where a.game_id = $1 and f.is_active order by f.formula_version desc, a.metric_id`,
        [rule.gameId],
      );
      const { rows: active } = await h.t.admin.query<{ v: number }>(
        "select max(formula_version) as v from public.contribution_formulas where game_id = $1 and is_active",
        [rule.gameId],
      );
      expect(active[0].v).toBe(rule.formulaVersion);
      expect(Object.fromEntries(rows.map((r) => [r.metric_id, r.weight_bp / 10_000]))).toEqual(rule.metricWeights);
      for (const row of rows) expect(row.department_id).toBe(getMetric(row.metric_id)!.departmentId);
    }
  });
});

describe("verified round → contribution event", () => {
  let h: Harness;
  let alice: string;
  let bob: string;
  beforeAll(async () => {
    h = await harness();
    alice = await h.t.createUser("alice@example.com", "Alice");
    bob = await h.t.createUser("bob@example.com", "Bob");
  }, 60_000);

  it("records one event with the verified inputs when a round is finalized", async () => {
    const round = await playRound(h, alice, 4);
    const result = await h.service.submitRound(alice, round.sessionId, { entries: round.entries });
    const [event] = await eventsFor(h, alice);
    expect(event).toMatchObject({
      session_id: round.sessionId,
      user_id: alice,
      game_id: "reconciliation-rush",
      rules_version: 1,
      seed: round.seed,
      formula_version: 1,
      difficulty: "associate",
      completion: "submitted",
      assisted: false,
      score: result.record.score,
      max_score: result.record.maxScore,
      objectives_completed: 4,
      objectives_total: 5,
      mistakes: result.record.incorrectCorrections,
      source: "finalize",
    });
    // The quarter comes from the database completion time, identical to the result's.
    expect(new Date(event.completed_at).toISOString()).toBe(result.record.completedAt);
    expect(event.period_id).toBe(periodOf(result.record.completedAt));
  });

  it("normalizes identically from the stored event and from the verified record, and ignores XP", async () => {
    const [row] = await eventsFor(h, alice);
    const { rows } = await h.t.admin.query<Parameters<typeof resultRowToRecord>[0]>("select * from public.game_results where session_id = $1", [row.session_id]);
    const record = resultRowToRecord(rows[0]);
    const fromRow = contributionEventFromRow(row);
    const fromRecord = contributionEventFromVerifiedResult({ ...record, xpAwarded: 99_999 }, alice);
    expect({ ...fromRow, formulaVersion: undefined }).toEqual({ ...fromRecord, formulaVersion: undefined });
    expect(normalizeEvent(fromRow, RECONCILIATION_RUSH_RULE)).toBe(normalizeEvent(fromRecord, RECONCILIATION_RUSH_RULE));
    expect(normalizeEvent(fromRow, RECONCILIATION_RUSH_RULE)).toBeGreaterThan(0);
  });

  it("feeds Controlling and Finance only, whatever the ledger's business", async () => {
    const rows = await eventsFor(h, alice);
    const { contributions } = aggregatePeriod(rows.map(contributionEventFromRow), {
      periodId: rows[0].period_id as never,
      provenance: "server-verified",
      rules: LIVE_GAME_RULES,
      metricIds: METRICS.map((m) => m.id),
    });
    const credited = contributions.totalCredited;
    expect(contributions.byMetric["ledger-integrity"] + contributions.byMetric["close-quality"]).toBe(credited);
    expect(Object.entries(contributions.byMetric).filter(([id, v]) => v > 0 && !["ledger-integrity", "close-quality"].includes(id))).toEqual([]);
  });

  it("keeps score and XP exactly as before", async () => {
    const round = await playRound(h, bob, 5);
    const result = await h.service.submitRound(bob, round.sessionId, { entries: round.entries });
    expect(result.record.xpAwarded).toBe(xpForScore(result.record.score));
    expect(result.totalXp).toBe(result.record.xpAwarded);
    const [event] = await eventsFor(h, bob);
    expect(event.score).toBe(result.record.score);
    expect(await counts(h, bob)).toEqual({ results: 1, xp_rows: 1, events: 1 });
  });

  it("records timed-out rounds too", async () => {
    const round = await playRound(h, bob, 5);
    await h.t.admin.query(
      "update public.game_sessions set started_at = now() - interval '200 seconds', deadline_at = now() - interval '110 seconds' where id = $1",
      [round.sessionId],
    );
    const result = await h.service.submitRound(bob, round.sessionId, { entries: round.entries });
    expect(result.record.completion).toBe("timedOut");
    const event = (await eventsFor(h, bob)).find((e) => e.session_id === round.sessionId)!;
    expect(event).toMatchObject({ completion: "timedOut", objectives_completed: 0, score: 0, source: "finalize" });
  });

  it("creates no second event for duplicate submissions", async () => {
    const player = await h.t.createUser("dup@example.com");
    const round = await playRound(h, player);
    await h.service.submitRound(player, round.sessionId, { entries: round.entries });
    const before = await eventsFor(h, player);
    const again = await h.store.finalize(round.sessionId, player, finalizeArgs(round.sessionId, player).p_result as never, {});
    expect(again.created).toBe(false);
    expect(again.contribution).toEqual({ status: "duplicate", eventId: before[0].id });
    expect(await eventsFor(h, player)).toEqual(before);
  });

  it("records exactly one event under concurrent submissions", async () => {
    const player = await h.t.createUser("concurrent@example.com");
    const round = await playRound(h, player);
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => h.service.submitRound(player, round.sessionId, { entries: i % 2 ? round.entries : {} })),
    );
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(await counts(h, player)).toEqual({ results: 1, xp_rows: 1, events: 1 });
  });

  it("ignores client-supplied timestamps and quarters", async () => {
    const player = await h.t.createUser("clock@example.com");
    const round = await playRound(h, player);
    await h.service.submitRound(player, round.sessionId, {
      entries: round.entries,
      completedAt: "2020-01-01T00:00:00.000Z",
      periodId: "2020-Q1",
      quarter: "2020-Q1",
    });
    const args = finalizeArgs(round.sessionId, player);
    // Even a direct (trusted) call can't choose the time: completed_at isn't an input.
    await h.t.serviceRpc("finalize_game_session", { ...args, p_result: { ...args.p_result, completed_at: "2020-01-01T00:00:00Z" } });
    const [event] = await eventsFor(h, player);
    const { rows } = await h.t.admin.query<{ now: string; q: string }>("select now() as now, public.utc_quarter(now()) as q");
    expect(Math.abs(new Date(event.completed_at).getTime() - new Date(rows[0].now).getTime())).toBeLessThan(60_000);
    expect(event.period_id).toBe(rows[0].q);
  });
});

describe("seed replays", () => {
  let h: Harness;
  let player: string;
  beforeAll(async () => {
    h = await harness();
    player = await h.t.createUser("replay@example.com");
  }, 60_000);

  it("never records a second event for a seed the player already completed, even in a later quarter", async () => {
    const first = await playRound(h, player);
    await h.service.submitRound(player, first.sessionId, { entries: first.entries });
    // Seeds are unique per session; free the old value to replay it, as the XP replay test does.
    await h.t.arrange("update public.game_sessions set seed = seed || '-original' where id = $1", [first.sessionId]);
    const replayService = createVerifiedRoundService({ store: h.store, createSeed: () => first.seed });
    const replay = await replayService.startRound(player);
    const result = await h.store.finalize(replay.sessionId, player, finalizeArgs(replay.sessionId, player).p_result as never, {});
    expect(result.created).toBe(true);
    expect(result.result.xp_awarded).toBe(0);
    expect(result.contribution).toEqual({ status: "seed_replay", eventId: null });
    expect((await eventsFor(h, player)).map((e) => e.session_id)).toEqual([first.sessionId]);
  });

  it("lets the earliest completion win during backfill", async () => {
    const other = await h.t.createUser("replay-backfill@example.com");
    // Two verified results with the same seed in different quarters, recorded before events existed.
    const ids: string[] = [];
    for (const [i, completedAt] of ["2026-06-30T23:59:59Z", "2026-03-15T12:00:00Z"].entries()) {
      const { rows } = await h.t.admin.query<{ id: string }>(
        `insert into public.game_sessions (user_id, game_id, rules_version, seed, status, deadline_at, finalized_at)
         values ($1, 'reconciliation-rush', 1, $2, 'finalized', now() + interval '90 seconds', now()) returning id`,
        [other, `RV1-shared-seed-session-${i}`],
      );
      ids.push(rows[0].id);
      await h.t.admin.query(
        `insert into public.game_results (session_id, user_id, game_id, rules_version, seed, department, difficulty, completion,
           score, max_score, grade, errors_fixed, total_errors, incorrect_corrections, time_used_ms, time_remaining_ms,
           assistance_used, xp_awarded, completed_at)
         values ($1, $2, 'reconciliation-rush', 1, 'RV1-shared-seed-value', 'Sales', 'associate', 'submitted',
           900, 1050, 'Exceeds', 5, 5, 0, 40000, 50000, false, 45, $3)`,
        [rows[0].id, other, completedAt],
      );
    }
    const outcome = (await h.t.serviceRpc("backfill_contribution_events", { p_limit: 100 })) as Record<string, number>;
    // Two replays: the shared seed here, plus the replayed round from the previous test.
    expect(outcome).toMatchObject({ created: 1, seed_replays: 2 });
    const events = await eventsFor(h, other);
    expect(events.map((e) => [e.session_id, e.period_id, e.source])).toEqual([[ids[1], "2026-Q1", "backfill"]]);
  });
});

describe("UTC quarters", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
  }, 60_000);

  it.each([
    ["2026-01-01T00:00:00.000Z", "2026-Q1"],
    ["2026-03-31T23:59:59.999Z", "2026-Q1"],
    ["2026-04-01T00:00:00.000Z", "2026-Q2"],
    ["2026-04-01T01:30:00+02:00", "2026-Q1"],
    ["2026-06-30T23:00:00-05:00", "2026-Q3"],
    ["2026-09-30T23:59:59.999Z", "2026-Q3"],
    ["2026-10-01T00:00:00.000Z", "2026-Q4"],
    ["2026-12-31T23:59:59.999Z", "2026-Q4"],
    ["2027-01-01T00:00:00.000Z", "2027-Q1"],
    ["2024-02-29T12:00:00.000Z", "2024-Q1"],
  ])("%s is in %s in both Postgres and TypeScript", async (timestamp, quarter) => {
    const { rows } = await h.t.admin.query<{ q: string }>("select public.utc_quarter($1::timestamptz) as q", [timestamp]);
    expect(rows[0].q).toBe(quarter);
    expect(periodOf(timestamp)).toBe(quarter);
  });

  it("can't be set directly", async () => {
    await expect(h.t.admin.query("update public.contribution_events set period_id = '2020-Q1'")).rejects.toThrow(/can only be updated to DEFAULT|generated|append_only/);
  });
});

describe("database authorization", () => {
  let h: Harness;
  let alice: string;
  let bob: string;
  let sessionId: string;
  beforeAll(async () => {
    h = await harness();
    alice = await h.t.createUser("auth-alice@example.com");
    bob = await h.t.createUser("auth-bob@example.com");
    const round = await playRound(h, alice);
    sessionId = round.sessionId;
    await h.service.submitRound(alice, round.sessionId, { entries: round.entries });
  }, 60_000);

  const insertEvent = (userId: string, sid: string) =>
    `insert into public.contribution_events (session_id, user_id, game_id, rules_version, seed, formula_version, completed_at,
       difficulty, completion, assisted, score, max_score, objectives_completed, objectives_total, mistakes, source)
     values ('${sid}', '${userId}', 'reconciliation-rush', 1, 'RV1-forged-seed-xxxx', 1, now(), 'associate', 'submitted', false,
       1050, 1050, 5, 5, 0, 'finalize')`;

  it("hides events from players and visitors, including their own", async () => {
    await expect(h.t.asUser(alice, (db) => db.query("select * from public.contribution_events"))).rejects.toThrow(denied);
    await expect(h.t.asAnon((db) => db.query("select * from public.contribution_events"))).rejects.toThrow(denied);
  });

  it("blocks direct writes by players, including forging someone else's", async () => {
    for (const sql of [
      insertEvent(alice, sessionId),
      insertEvent(bob, sessionId),
      "update public.contribution_events set score = 1050",
      "delete from public.contribution_events",
      "insert into public.contribution_allocations values ('reconciliation-rush', 1, 'pipeline-health', 'sales', 1)",
      "update public.contribution_formulas set is_active = false",
    ]) {
      await expect(h.t.asUser(bob, (db) => db.query(sql)), sql).rejects.toThrow(denied);
      await expect(h.t.asAnon((db) => db.query(sql)), sql).rejects.toThrow(denied);
    }
  });

  it("keeps the trusted functions away from players", async () => {
    for (const sql of [
      `select public.record_contribution_event('${sessionId}', 'finalize')`,
      "select public.backfill_contribution_events(10)",
    ]) {
      await expect(h.t.asUser(alice, (db) => db.query(sql)), sql).rejects.toThrow(denied);
      await expect(h.t.asAnon((db) => db.query(sql)), sql).rejects.toThrow(denied);
    }
  });

  it("lets the service role read and backfill, but not write events or call the internal function", async () => {
    expect(((await h.t.serviceRpc("backfill_contribution_events", { p_limit: 10 })) as { created: number }).created).toBe(0);
    await expect(h.t.serviceRpc("record_contribution_event", { p_session_id: sessionId, p_source: "finalize" })).rejects.toThrow(denied);
    for (const sql of [insertEvent(bob, sessionId), "update public.contribution_events set score = 1", "delete from public.contribution_events"]) {
      await expect(
        (async () => {
          await h.t.db.exec("set role service_role");
          try {
            await h.t.db.query(sql);
          } finally {
            await h.t.db.exec("reset role");
          }
        })(),
        sql,
      ).rejects.toThrow(denied);
    }
    await h.t.db.exec("set role service_role");
    try {
      const { rows } = await h.t.db.query("select count(*)::int as n from public.contribution_events");
      expect(rows[0]).toEqual({ n: 1 });
    } finally {
      await h.t.db.exec("reset role");
    }
  });

  it("is append-only even for the database owner", async () => {
    await expect(h.t.admin.query("update public.contribution_events set score = 1")).rejects.toThrow(/append_only/);
    await expect(h.t.admin.query("delete from public.contribution_events")).rejects.toThrow(/append_only/);
    await expect(h.t.admin.query("truncate public.contribution_events")).rejects.toThrow(/append_only/);
    await expect(h.t.admin.query("update public.contribution_allocations set weight_bp = 5000")).rejects.toThrow(/immutable/);
    await expect(h.t.admin.query("delete from public.contribution_formulas")).rejects.toThrow(/immutable/);
    // The formula is in use, so it can't gain allocations.
    await expect(
      h.t.admin.query("insert into public.contribution_allocations values ('reconciliation-rush', 1, 'pipeline-health', 'sales', 1)"),
    ).rejects.toThrow(/in_use/);
  });

  it("validates the source and rejects unknown rounds", async () => {
    await expect(h.t.admin.query(`select public.record_contribution_event('${sessionId}', 'browser')`)).rejects.toThrow(/invalid_contribution_source/);
    await expect(h.t.admin.query("select public.record_contribution_event(gen_random_uuid(), 'finalize')")).rejects.toThrow(/result_not_found/);
    await expect(h.t.serviceRpc("backfill_contribution_events", { p_limit: 0 })).rejects.toThrow(/invalid_limit/);
    await expect(h.t.serviceRpc("backfill_contribution_events", { p_limit: 100_000 })).rejects.toThrow(/invalid_limit/);
  });

  it("removes a player's events only when the account is deleted", async () => {
    const leaver = await h.t.createUser("leaver@example.com");
    const round = await playRound(h, leaver);
    await h.service.submitRound(leaver, round.sessionId, { entries: round.entries });
    expect((await counts(h, leaver)).events).toBe(1);
    await h.t.admin.query("delete from auth.users where id = $1", [leaver]);
    expect(await counts(h, leaver)).toEqual({ results: 0, xp_rows: 0, events: 0 });
  });
});

describe("transactions, recovery and formula versions", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
  }, 60_000);
  afterAll(async () => {
    await h.t.db.close();
  });

  it("rolls back result and XP when the contribution can't be recorded, and succeeds on retry once fixed", async () => {
    const player = await h.t.createUser("rollback@example.com");
    const round = await playRound(h, player);
    // A broken active formula (allocations don't sum to 100%).
    await h.t.admin.query("insert into public.contribution_formulas (game_id, formula_version) values ('reconciliation-rush', 50)");
    await h.t.admin.query("insert into public.contribution_allocations values ('reconciliation-rush', 50, 'ledger-integrity', 'controlling', 5000)");
    await expect(h.service.submitRound(player, round.sessionId, { entries: round.entries })).rejects.toThrow();
    expect(await counts(h, player)).toEqual({ results: 0, xp_rows: 0, events: 0 });
    const { rows } = await h.t.admin.query("select status from public.game_sessions where id = $1", [round.sessionId]);
    expect(rows[0]).toEqual({ status: "active" });

    await h.t.admin.query("update public.contribution_formulas set is_active = false where formula_version = 50");
    const retry = await h.service.submitRound(player, round.sessionId, { entries: round.entries });
    expect(retry.created).toBe(true);
    expect(await counts(h, player)).toEqual({ results: 1, xp_rows: 1, events: 1 });
    expect((await eventsFor(h, player))[0].formula_version).toBe(1);
  });

  it("rejects invalid result payloads without writing anything", async () => {
    const player = await h.t.createUser("invalid@example.com");
    const round = await playRound(h, player);
    const args = finalizeArgs(round.sessionId, player);
    await expect(h.t.serviceRpc("finalize_game_session", { ...args, p_result: { ...args.p_result, score: 2000 } })).rejects.toThrow(/check/);
    await expect(h.t.serviceRpc("finalize_game_session", { ...args, p_result: { ...args.p_result, errors_fixed: 9 } })).rejects.toThrow(/check/);
    expect(await counts(h, player)).toEqual({ results: 0, xp_rows: 0, events: 0 });
  });

  it("recovers missing events for already-finalized results, idempotently", async () => {
    const player = await h.t.createUser("recovery@example.com");
    // Rounds finalized while no formula was active (like results from before this migration).
    await h.t.admin.query("update public.contribution_formulas set is_active = false where game_id = 'reconciliation-rush'");
    const a = await playRound(h, player);
    const first = await h.service.submitRound(player, a.sessionId, { entries: a.entries });
    const b = await playRound(h, player);
    await h.service.submitRound(player, b.sessionId, { entries: b.entries });
    expect(await counts(h, player)).toEqual({ results: 2, xp_rows: 2, events: 0 });
    await h.t.admin.query("update public.contribution_formulas set is_active = true where game_id = 'reconciliation-rush' and formula_version = 1");

    // A retried submission heals its own round...
    const retried = await h.store.finalize(a.sessionId, player, finalizeArgs(a.sessionId, player).p_result as never, {});
    expect(retried.created).toBe(false);
    expect(retried.contribution?.status).toBe("created");
    // ...and the backfill catches the rest, once.
    const backfill = (await h.t.serviceRpc("backfill_contribution_events", { p_limit: 100 })) as Record<string, number>;
    expect(backfill).toMatchObject({ created: 1, without_event: 0 });
    expect(((await h.t.serviceRpc("backfill_contribution_events", { p_limit: 100 })) as Record<string, number>).created).toBe(0);

    const events = await eventsFor(h, player);
    expect(Object.fromEntries(events.map((e) => [e.session_id, e.source]))).toEqual({ [a.sessionId]: "recovery", [b.sessionId]: "backfill" });
    // Recovery never touches XP: still one ledger row per result, matching the results.
    expect(await counts(h, player)).toEqual({ results: 2, xp_rows: 2, events: 2 });
    const xp = await h.t.admin.query<{ ledger: number; results: number }>(
      `select (select sum(amount)::int from public.xp_ledger where user_id = $1) as ledger,
              (select sum(xp_awarded)::int from public.game_results where user_id = $1) as results`,
      [player],
    );
    expect(xp.rows[0].ledger).toBe(xp.rows[0].results);
    expect(first.record.xpAwarded).toBe(xpForScore(first.record.score));
  });

  it("never turns imported guest history into contributions", async () => {
    const player = await h.t.createUser("guest-import@example.com");
    await h.t.serviceRpc("import_legacy_results", {
      p_user_id: player,
      p_records: [{ id: "local-1", gameId: "reconciliation-rush", completedAt: "2026-10-01T00:00:00Z", score: 1050, seed: "RR-LOCAL" }],
    });
    await h.t.serviceRpc("backfill_contribution_events", { p_limit: 100 });
    expect((await counts(h, player)).events).toBe(0);
  });

  it("pins each event to the formula version active when it was recorded", async () => {
    const player = await h.t.createUser("versions@example.com");
    const before = await playRound(h, player);
    await h.service.submitRound(player, before.sessionId, { entries: before.entries });

    await h.t.admin.query("insert into public.contribution_formulas (game_id, formula_version) values ('reconciliation-rush', 2)");
    await h.t.admin.query(
      "insert into public.contribution_allocations values ('reconciliation-rush', 2, 'ledger-integrity', 'controlling', 6000), ('reconciliation-rush', 2, 'close-quality', 'finance', 4000)",
    );
    const after = await playRound(h, player);
    await h.service.submitRound(player, after.sessionId, { entries: after.entries });

    const events = await eventsFor(h, player);
    expect(events.map((e) => e.formula_version)).toEqual([1, 2]);
    // The engine refuses to normalize an event under a formula version it doesn't implement.
    const { contributions } = aggregatePeriod(events.map(contributionEventFromRow), {
      periodId: events[0].period_id as never,
      provenance: "server-verified",
      rules: LIVE_GAME_RULES,
      metricIds: METRICS.map((m) => m.id),
    });
    expect(contributions.accepted.map((c) => c.eventId)).toEqual([before.sessionId]);
    expect(contributions.rejected).toEqual([{ eventId: after.sessionId, reason: "unsupportedFormulaVersion" }]);
    expect(contributions.totalCredited).toBeLessThanOrEqual(CONTRIBUTION_RULES.playerHardCap);
  });
});
