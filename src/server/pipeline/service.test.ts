/**
 * Verified Pipeline Panic rounds: service + RPC adapter + the real SQL
 * functions and migrations in PGlite.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { xpForScore } from "@/career/xp";
import { summarizeDepartmentCareer, type MembershipRow } from "@/career/department-membership";
import { evaluatePipeline } from "@/games/pipeline-panic/evaluate";
import { scorePipeline } from "@/games/pipeline-panic/scoring";
import { solveRound } from "@/games/pipeline-panic/solve";
import type { PipelineDecision, PipelineRound } from "@/games/pipeline-panic/types";
import { createCompanyService } from "../company/service";
import { selectDepartment } from "../departments/service";
import { RoundError } from "../rounds/errors";
import { createRpcRoundStore, type ResultRow, type RoundStore } from "../rounds/round-store";
import { createVerifiedRoundService, resultRowToRecord } from "../rounds/service";
import { createTestDatabase, type TestDatabase } from "../testing/test-database";
import { pipelineRoundFor } from "./rules";
import { createPipelineRoundService, type PipelineRoundService } from "./service";

let t: TestDatabase;
let store: RoundStore;
let service: PipelineRoundService;
let counter = 0;

beforeAll(async () => {
  t = await createTestDatabase();
  store = createRpcRoundStore(t.serviceRpc);
  service = createPipelineRoundService({ store, createSeed: () => `PP1-test-${String(++counter).padStart(8, "0")}-seed` });
}, 60_000);

async function start(userId: string) {
  const response = await service.startRound(userId);
  const session = await store.getSession(response.sessionId, userId);
  return { response, round: pipelineRoundFor(1, session!.seed) };
}

const answers = (round: PipelineRound): Record<string, PipelineDecision> =>
  Object.fromEntries(Object.entries(solveRound(round)).map(([id, r]) => [id, r.decision]));

async function counts(userId: string) {
  const { rows } = await t.admin.query<{ results: number; xp: number; events: number }>(
    `select (select count(*)::int from public.game_results where user_id = $1) as results,
            (select count(*)::int from public.xp_ledger where user_id = $1) as xp,
            (select count(*)::int from public.contribution_events where user_id = $1) as events`,
    [userId],
  );
  return rows[0];
}

const expectCode = async (promise: Promise<unknown>, code: string) => {
  const error = await promise.then(() => null, (e) => e);
  expect(error).toBeInstanceOf(RoundError);
  expect((error as RoundError).code).toBe(code);
};

/** Moves a session's clock: the round started `elapsedMs` ago (database time). */
const age = (sessionId: string, elapsedMs: number) =>
  t.admin.query(
    `update public.game_sessions set started_at = now() - $2 * interval '1 millisecond',
       deadline_at = now() - $2 * interval '1 millisecond' + interval '90 seconds' where id = $1`,
    [sessionId, elapsedMs],
  );

describe("starting", () => {
  it("sends the public round only: no seed and no answer labels", async () => {
    const player = await t.createUser("pp-start@example.com");
    const { response, round } = await start(player);
    const json = JSON.stringify(response);
    expect(json).not.toContain(round.seed);
    expect(json).not.toContain("scenarios");
    expect(response.round.opportunities).toEqual(round.opportunities);
    expect(response.durationMs).toBe(90_000);
    const { rows } = await t.admin.query("select game_id, rules_version from public.game_sessions where id = $1", [response.sessionId]);
    expect(rows[0]).toEqual({ game_id: "pipeline-panic", rules_version: 1 });
  });
});

describe("submitting", () => {
  it("scores on the server, awards XP from the shared formula and records one Sales contribution", async () => {
    const player = await t.createUser("pp-perfect@example.com");
    const { response, round } = await start(player);
    const result = await service.submitRound(player, response.sessionId, { decisions: answers(round) });
    expect(result.created).toBe(true);
    expect(result.record).toMatchObject({ gameId: "pipeline-panic", department: "Sales", errorsFixed: round.opportunities.length, totalErrors: round.opportunities.length, incorrectCorrections: 0, completion: "submitted" });
    expect(result.record.xpAwarded).toBe(xpForScore(result.record.score));
    expect(result.review.score.total).toBe(result.record.score);
    expect(result.review.score.timeBonus).toBeGreaterThan(150);
    expect(result.contribution).toEqual({ recorded: true });
    expect(await counts(player)).toEqual({ results: 1, xp: 1, events: 1 });
    const { rows } = await t.admin.query("select game_id, formula_version, objectives_completed, objectives_total, mistakes from public.contribution_events where user_id = $1", [player]);
    expect(rows[0]).toEqual({ game_id: "pipeline-panic", formula_version: 1, objectives_completed: round.opportunities.length, objectives_total: round.opportunities.length, mistakes: 0 });
  });

  it("reproduces the score exactly from the stored decisions", async () => {
    const player = await t.createUser("pp-repro@example.com");
    const { response, round } = await start(player);
    const decisions = { ...answers(round), [round.opportunities[0].id]: { action: "reject" } as PipelineDecision };
    delete (decisions as Record<string, PipelineDecision>)[round.opportunities[1].id];
    const result = await service.submitRound(player, response.sessionId, { decisions });
    const evaluation = evaluatePipeline(round, decisions);
    const expected = scorePipeline(round, evaluation, result.record.timeRemainingMs, 90_000);
    expect(result.record.score).toBe(expected.total);
    expect(result.review.decisions).toEqual(decisions);
  });

  it("returns a review that hides every answer the player didn't attempt", async () => {
    const player = await t.createUser("pp-redact@example.com");
    const { response, round } = await start(player);
    const all = answers(round);
    const attempted = round.opportunities.slice(0, 4).map((o) => o.id);
    const decisions = Object.fromEntries(attempted.map((id) => [id, all[id]]));
    const result = await service.submitRound(player, response.sessionId, { decisions });
    const json = JSON.stringify(result);
    const full = evaluatePipeline(round, decisions);
    for (const o of full.outcomes.filter((x) => x.kind === "undecided")) {
      expect(json).not.toContain(o.explanation);
      expect(result.review.outcomes.find((r) => r.id === o.id)).toEqual({ id: o.id, decision: null, kind: "undecided" });
    }
    for (const id of attempted) expect(result.review.outcomes.find((r) => r.id === id)).toMatchObject({ kind: "correct", bestDecision: all[id] });
    expect(json).not.toContain(round.seed);
    expect(result.record.seed).toMatch(/^ref-[0-9a-f]{24}$/);
    expect(JSON.stringify(result.review)).not.toMatch(/"scenarios"|"resolution"|"difficulty"/);
    // Scoring, XP and the stored result are unaffected by redaction.
    const expected = scorePipeline(round, full, result.record.timeRemainingMs, 90_000);
    expect(result.record.score).toBe(expected.total);
    expect(result.review.score).toEqual(expected);
    expect(result.record.xpAwarded).toBe(xpForScore(expected.total));
    expect(result.record).toMatchObject({ errorsFixed: 4, totalErrors: round.opportunities.length, incorrectCorrections: 0 });
    // A retry returns the same redacted review.
    expect((await service.submitRound(player, response.sessionId, {})).review).toEqual(result.review);
  });

  it("ignores self-reported scores, times, XP and outcomes", async () => {
    const player = await t.createUser("pp-forged@example.com");
    const { response } = await start(player);
    const result = await service.submitRound(player, response.sessionId, { decisions: {}, score: 1300, xpAwarded: 999, completion: "submitted", timeRemainingMs: 90_000 });
    expect(result.record).toMatchObject({ score: 0, xpAwarded: 0, errorsFixed: 0 });
  });

  it.each([
    ["an array", { decisions: [] }],
    ["an unknown opportunity", { decisions: { "opp-99": { action: "close" } } }],
    ["an invalid action", { decisions: { "opp-1": { action: "sell" } } }],
    ["an invalid discount", { decisions: { "opp-1": { action: "discount", discount: 12 } } }],
    ["a discount on a non-discount action", { decisions: { "opp-1": { action: "close", discount: 5 } } }],
    ["a non-object body", "decisions"],
  ])("rejects a tampered submission: %s", async (_, body) => {
    const player = await t.createUser(`pp-tamper-${Math.random()}@example.com`);
    const { response } = await start(player);
    await expectCode(service.submitRound(player, response.sessionId, body), "invalid_payload");
    expect(await counts(player)).toEqual({ results: 0, xp: 0, events: 0 });
  });

  it("returns the stored result for duplicates and finalizes concurrent submissions once", async () => {
    const player = await t.createUser("pp-dupe@example.com");
    const { response, round } = await start(player);
    const results = await Promise.all([
      service.submitRound(player, response.sessionId, { decisions: answers(round) }),
      service.submitRound(player, response.sessionId, { decisions: {} }),
      service.submitRound(player, response.sessionId, { decisions: answers(round) }),
    ]);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => JSON.stringify(r.record))).size).toBe(1);
    const again = await service.submitRound(player, response.sessionId, { decisions: {} });
    expect(again.created).toBe(false);
    expect(await counts(player)).toEqual({ results: 1, xp: 1, events: 1 });
  });

  it("keeps games apart: a Pipeline Panic round can't be submitted as Reconciliation Rush, or the reverse", async () => {
    const player = await t.createUser("pp-cross@example.com");
    const rush = createVerifiedRoundService({ store, createSeed: () => `RV1-cross-${String(++counter).padStart(8, "0")}-seed` });
    const { response } = await start(player);
    await expectCode(rush.submitRound(player, response.sessionId, { entries: {} }), "not_found");
    const rushRound = await rush.startRound(player);
    await expectCode(service.submitRound(player, rushRound.sessionId, { decisions: {} }), "not_found");
    await expectCode(service.requestHint(player, rushRound.sessionId, { decisions: {} }), "not_found");
  });

  it("refuses another player's round as if it didn't exist", async () => {
    const owner = await t.createUser("pp-owner@example.com");
    const other = await t.createUser("pp-other@example.com");
    const { response, round } = await start(owner);
    await expectCode(service.submitRound(other, response.sessionId, { decisions: answers(round) }), "not_found");
    expect(await counts(other)).toEqual({ results: 0, xp: 0, events: 0 });
  });
});

describe("deadlines (database time)", () => {
  it("scores a submission inside the network tolerance as timed out, without time bonus", async () => {
    const player = await t.createUser("pp-late@example.com");
    const { response, round } = await start(player);
    await age(response.sessionId, 91_500);
    const result = await service.submitRound(player, response.sessionId, { decisions: answers(round) });
    expect(result.record).toMatchObject({ completion: "timedOut", errorsFixed: round.opportunities.length, timeRemainingMs: 0 });
    expect(result.review.score.timeBonus).toBe(0);
  });

  it("ignores decisions sent after the tolerance", async () => {
    const player = await t.createUser("pp-very-late@example.com");
    const { response, round } = await start(player);
    await age(response.sessionId, 120_000);
    const result = await service.submitRound(player, response.sessionId, { decisions: answers(round) });
    expect(result.record).toMatchObject({ completion: "timedOut", errorsFixed: 0, score: 0, xpAwarded: 0 });
  });
});

describe("Request Assistance", () => {
  it("gives one stored hint, closes after the deadline and has no score penalty", async () => {
    const player = await t.createUser("pp-hint@example.com");
    const { response, round } = await start(player);
    const first = await service.requestHint(player, response.sessionId, { decisions: {} });
    expect(first.hint.opportunityId).toBe(round.opportunities[0].id);
    const again = await service.requestHint(player, response.sessionId, { decisions: answers(round) });
    expect(again.hint).toEqual(first.hint);
    const result = await service.submitRound(player, response.sessionId, { decisions: answers(round) });
    expect(result.record.assistanceUsed).toBe(true);
    expect(result.review.hint?.message).toBe(first.hint.message);
    expect(result.review.score.total).toBe(result.review.score.maxPossible - (200 - result.review.score.timeBonus));
    const { rows } = await t.admin.query("select assisted from public.contribution_events where session_id = $1", [response.sessionId]);
    expect(rows[0]).toEqual({ assisted: true });

    const late = await start(player);
    await age(late.response.sessionId, 120_000);
    await expectCode(service.requestHint(player, late.response.sessionId, { decisions: {} }), "session_closed");
  });
});

describe("Sales career and Live Company", () => {
  it("counts qualifying verified rounds toward the Sales career", async () => {
    const player = await t.createUser("pp-sales@example.com");
    await selectDepartment(t.serviceRpc, player, { departmentId: "sales", requestId: crypto.randomUUID() });
    for (let i = 0; i < 3; i++) {
      const { response, round } = await start(player);
      await service.submitRound(player, response.sessionId, { decisions: answers(round) });
    }
    const { rows } = await t.admin.query<ResultRow>("select * from public.game_results where user_id = $1", [player]);
    const { rows: memberships } = await t.admin.query<MembershipRow>(
      "select id, department_id, started_at, ended_at, start_reason, end_reason from public.department_memberships where user_id = $1",
      [player],
    );
    const summary = summarizeDepartmentCareer(memberships, rows.map(resultRowToRecord), new Date());
    expect(summary.progress[0]).toMatchObject({ departmentId: "sales", positionIndex: 1, qualifyingRounds: 3 });
  });

  it("feeds Sales in the live company without changing Reconciliation Rush contributions", async () => {
    const company = createCompanyService({ rpc: t.serviceRpc, ttlMs: 0 });
    const snapshot = await company.getSnapshot();
    const sales = snapshot.departments.find((d) => d.id === "sales")!;
    expect(sales.measured).toBe(true);
    expect(sales.attainment!).toBeGreaterThan(0);
    const { rows } = await t.admin.query(
      "select game_id, formula_version, metric_id, department_id, weight_bp from public.contribution_allocations order by game_id, metric_id",
    );
    expect(rows).toEqual([
      { game_id: "pipeline-panic", formula_version: 1, metric_id: "pipeline-health", department_id: "sales", weight_bp: 10000 },
      { game_id: "reconciliation-rush", formula_version: 1, metric_id: "close-quality", department_id: "finance", weight_bp: 3000 },
      { game_id: "reconciliation-rush", formula_version: 1, metric_id: "ledger-integrity", department_id: "controlling", weight_bp: 7000 },
    ]);
    const integrity = (await t.serviceRpc("check_progression_integrity", {})) as Record<string, number>;
    expect(Object.values(integrity).every((n) => n === 0)).toBe(true);
  });
});
