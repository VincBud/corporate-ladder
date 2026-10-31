/**
 * Live company aggregation against the real migrations in PGlite, fed by
 * real verified rounds through the round service.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { cellKey } from "@/games/spreadsheet-wars/sheet";
import { LIVE_COMPANY } from "@/simulation/live";
import { parseCompanySnapshot } from "@/simulation/source";
import { createRpcRoundStore, type RpcCall } from "../rounds/round-store";
import { challengeFor } from "../rounds/rules";
import { createVerifiedRoundService, type VerifiedRoundService } from "../rounds/service";
import { createTestDatabase, type TestDatabase } from "../testing/test-database";
import { CompanyUnavailableError, createCompanyService, parseQuarterData } from "./service";

const denied = /permission denied/;
let seedCounter = 0;
const nextSeed = () => `RV1-company-${String(++seedCounter).padStart(8, "0")}-seed`;

let t: TestDatabase;
let rounds: VerifiedRoundService;

beforeAll(async () => {
  t = await createTestDatabase();
  rounds = createVerifiedRoundService({ store: createRpcRoundStore(t.serviceRpc), createSeed: nextSeed });
}, 60_000);

async function play(userId: string, fixed = 5) {
  const started = await rounds.startRound(userId);
  const { rows } = await t.admin.query<{ seed: string }>("select seed from public.game_sessions where id = $1", [started.sessionId]);
  const challenge = challengeFor(1, rows[0].seed);
  const entries = Object.fromEntries(
    challenge.errors.slice(0, fixed).map((e) => [cellKey(e.address), challenge.cells.get(cellKey(e.address))!.solution]),
  );
  return rounds.submitRound(userId, started.sessionId, { entries });
}

const fresh = (rpc: RpcCall = t.serviceRpc) => createCompanyService({ rpc, ttlMs: 0 });

describe("live company snapshot", () => {
  let alice: string;
  let bob: string;
  let carol: string;
  let tester: string;

  it("starts empty: no employees, baseline figures only", async () => {
    const snapshot = await fresh().getSnapshot();
    expect(snapshot.dataStatus).toBe("noEmployees");
    expect(snapshot.employees).toMatchObject({ registered: 0, active: 0, contributing: 0 });
    expect(snapshot.financials.revenue).toBe(LIVE_COMPANY.baseRevenue);
    expect(snapshot.lastContributionAt).toBeNull();
  });

  it("counts registered employees, excluding test accounts", async () => {
    alice = await t.createUser("alice@example.com", "Alice");
    bob = await t.createUser("bob@example.com", "Bob");
    carol = await t.createUser("carol@example.com", "Carol");
    tester = await t.createUser("cl-live-test@example.com", "Tester", { testAccount: true });
    await t.serviceRpc("select_department", { p_user_id: alice, p_department_id: "finance", p_request_id: crypto.randomUUID() });
    const snapshot = await fresh().getSnapshot();
    expect(snapshot.dataStatus).toBe("noActivity");
    expect(snapshot.employees.registered).toBe(3);
  });

  it("reflects verified rounds, never test accounts or imported guest history", async () => {
    const first = await play(alice, 5);
    expect(first.contribution).toEqual({ recorded: true });
    await play(bob, 3);
    await play(tester, 5);
    await t.serviceRpc("import_legacy_results", {
      p_user_id: carol,
      p_records: [{ id: "local-1", gameId: "reconciliation-rush", completedAt: new Date().toISOString(), score: 1050, seed: "RR-LOCAL1" }],
    });

    const snapshot = await fresh().getSnapshot();
    expect(snapshot.dataStatus).toBe("active");
    expect(snapshot.employees).toMatchObject({ registered: 3, active: 2, contributing: 2 });
    expect(snapshot.financials.revenue).toBeGreaterThan(snapshot.baseline.revenue);
    expect(snapshot.impact.costSavings).toBeGreaterThan(0);
    expect(snapshot.departments.find((d) => d.id === "controlling")!.measured).toBe(true);
    expect(snapshot.departments.find((d) => d.id === "sales")!.measured).toBe(false);
    expect(parseCompanySnapshot(JSON.parse(JSON.stringify(snapshot)))).not.toBeNull();

    // The quarter and timestamps come from the database clock.
    const { rows } = await t.admin.query<{ q: string; latest: Date }>(
      `select public.utc_quarter(now()) as q,
              (select max(created_at) from public.contribution_events where user_id in ($1, $2)) as latest`,
      [alice, bob],
    );
    expect(snapshot.period.id).toBe(rows[0].q);
    expect(snapshot.lastContributionAt).toBe(new Date(rows[0].latest).toISOString());
  });

  it("publishes no ids, emails, seeds or per-player data", async () => {
    const json = JSON.stringify(await fresh().getSnapshot());
    const { rows } = await t.admin.query<{ id: string; seed: string; session_id: string }>("select id, seed, session_id from public.contribution_events");
    for (const id of [alice, bob, carol, tester]) expect(json).not.toContain(id);
    for (const row of rows) {
      expect(json).not.toContain(row.id);
      expect(json).not.toContain(row.seed);
      expect(json).not.toContain(row.session_id);
    }
    expect(json).not.toContain("@example.com");
    expect(json).not.toContain("Alice");
  });

  it("counts only the current quarter", async () => {
    // A verified result from last quarter, recorded through the backfill.
    const { rows } = await t.admin.query<{ id: string }>(
      `insert into public.game_sessions (user_id, game_id, rules_version, seed, status, deadline_at, finalized_at)
       values ($1, 'reconciliation-rush', 1, 'RV1-last-quarter-session', 'finalized', now() + interval '90 seconds', now()) returning id`,
      [carol],
    );
    await t.admin.query(
      `insert into public.game_results (session_id, user_id, game_id, rules_version, seed, department, difficulty, completion,
         score, max_score, grade, errors_fixed, total_errors, incorrect_corrections, time_used_ms, time_remaining_ms,
         assistance_used, xp_awarded, completed_at)
       values ($1, $2, 'reconciliation-rush', 1, 'RV1-last-quarter-session', 'Sales', 'associate', 'submitted',
         1050, 1050, 'Exceeds', 5, 5, 0, 40000, 50000, false, 52, now() - interval '4 months')`,
      [rows[0].id, carol],
    );
    await t.serviceRpc("backfill_contribution_events", { p_limit: 10 });
    const snapshot = await fresh().getSnapshot();
    expect(snapshot.employees.active).toBe(2);
  });

  it("is deterministic for the same data", async () => {
    const service = fresh();
    const a = await service.getSnapshot();
    const b = await service.getSnapshot();
    // Only the generation time (database clock) differs.
    expect({ ...b, generatedAt: null }).toEqual({ ...a, generatedAt: null });
  });

  it("shows a new verified round after the cache is invalidated", async () => {
    let calls = 0;
    const service = createCompanyService({
      rpc: async (fn, args) => {
        calls++;
        return t.serviceRpc(fn, args);
      },
      ttlMs: 60_000,
    });
    const before = await service.getSnapshot();
    await play(carol, 5);
    expect(await service.getSnapshot()).toBe(before); // cached
    service.invalidate();
    const after = await service.getSnapshot();
    expect(after.employees.active).toBe(before.employees.active + 1);
    expect(after.financials.revenue).toBeGreaterThanOrEqual(before.financials.revenue);
    expect(calls).toBe(2);
  });

  it("loads once for concurrent requests", async () => {
    let calls = 0;
    const service = createCompanyService({
      rpc: async (fn, args) => {
        calls++;
        return t.serviceRpc(fn, args);
      },
    });
    const snapshots = await Promise.all(Array.from({ length: 5 }, () => service.getSnapshot()));
    expect(calls).toBe(1);
    expect(new Set(snapshots).size).toBe(1);
  });
});

describe("failures", () => {
  it("reports database errors as unavailable", async () => {
    const service = fresh(async () => {
      throw new Error("connection refused");
    });
    await expect(service.getSnapshot()).rejects.toMatchObject({ name: "CompanyUnavailableError", reason: "database" });
  });

  it("rejects malformed data instead of guessing", async () => {
    const real = (await t.serviceRpc("get_company_quarter", { p_period_id: null })) as Record<string, unknown>;
    for (const broken of [
      null,
      { ...real, registered_employees: -1 },
      { ...real, period_id: "2020-Q1" },
      { ...real, membership: [{ department_id: null, members: 999 }] },
      { ...real, events: [{ user_id: "x" }] },
      { ...real, db_now: "soon" },
    ]) {
      expect(() => parseQuarterData(broken)).toThrow(CompanyUnavailableError);
      await expect(fresh(async () => broken).getSnapshot()).rejects.toMatchObject({ reason: "malformed" });
    }
  });

  it("refuses to compute with a formula that doesn't match the code", async () => {
    const service = fresh(async (fn, args) => {
      const data = (await t.serviceRpc(fn, args)) as { allocations: { weight_bp: number }[] };
      return { ...data, allocations: data.allocations.map((a) => ({ ...a, weight_bp: 5000 })) };
    });
    await expect(service.getSnapshot()).rejects.toMatchObject({ reason: "formula" });
  });

  it("recovers after a failure on the next request", async () => {
    let fail = true;
    const service = fresh(async (fn, args) => {
      if (fail) throw new Error("timeout");
      return t.serviceRpc(fn, args);
    });
    await expect(service.getSnapshot()).rejects.toThrow(CompanyUnavailableError);
    fail = false;
    await expect(service.getSnapshot()).resolves.toMatchObject({ schemaVersion: 1 });
  });
});

describe("authorization and contribution history", () => {
  it("keeps the company data function away from players and visitors", async () => {
    const player = await t.createUser("curious@example.com");
    await expect(t.asUser(player, (db) => db.query("select public.get_company_quarter(null)"))).rejects.toThrow(denied);
    await expect(t.asAnon((db) => db.query("select public.get_company_quarter(null)"))).rejects.toThrow(denied);
    await expect(t.serviceRpc("get_company_quarter", { p_period_id: "2026-Q9" })).rejects.toThrow(/invalid_period/);
  });

  it("gives players no way to delete verified results or contribution events", async () => {
    const player = await t.createUser("deleter@example.com");
    await play(player);
    for (const sql of ["delete from public.game_results", "delete from public.contribution_events", "delete from public.game_sessions"]) {
      await expect(t.asUser(player, (db) => db.query(sql)), sql).rejects.toThrow(denied);
    }
    const { rows } = await t.admin.query("select count(*)::int as n from public.contribution_events where user_id = $1", [player]);
    expect(rows[0]).toEqual({ n: 1 });
  });

  it("keeps verified results (and so their events) out of reach of the service role", async () => {
    const player = await t.createUser("cascade@example.com");
    await play(player);
    await t.db.exec("set role service_role");
    try {
      await expect(t.db.query("delete from public.game_results where user_id = $1", [player])).rejects.toThrow(denied);
    } finally {
      await t.db.exec("reset role");
    }
    const { rows } = await t.admin.query("select count(*)::int as n from public.contribution_events where user_id = $1", [player]);
    expect(rows[0]).toEqual({ n: 1 });
  });

  it("records a missing event when a finalized round is submitted again (recovery over the normal API path)", async () => {
    const player = await t.createUser("retry@example.com");
    await t.admin.query("update public.contribution_formulas set is_active = false where game_id = 'reconciliation-rush'");
    const started = await rounds.startRound(player);
    const first = await rounds.submitRound(player, started.sessionId, { entries: {} });
    expect(first.contribution).toEqual({ recorded: false });
    await t.admin.query("update public.contribution_formulas set is_active = true where game_id = 'reconciliation-rush' and formula_version = 1");
    const retry = await rounds.submitRound(player, started.sessionId, { entries: {} });
    expect(retry.created).toBe(false);
    expect(retry.contribution).toEqual({ recorded: true });
    expect(retry.record).toEqual(first.record);
    const { rows } = await t.admin.query("select source from public.contribution_events where session_id = $1", [started.sessionId]);
    expect(rows).toEqual([{ source: "recovery" }]);
  });
});
