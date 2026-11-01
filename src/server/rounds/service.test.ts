/**
 * Verified round lifecycle: service + RPC adapter + the real SQL functions,
 * running in PGlite. Time is moved by editing session timestamps in the
 * database, never by anything a client sends.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { xpForScore } from "@/career/xp";
import { serializePublicChallenge, toPublicChallenge } from "@/games/spreadsheet-wars/reconciliation-rush/public";
import { DIFFICULTY_POINTS } from "@/games/spreadsheet-wars/reconciliation-rush/scoring";
import { cellKey } from "@/games/spreadsheet-wars/sheet";
import { createTestDatabase, type TestDatabase } from "../testing/test-database";
import { RoundError } from "./errors";
import { createRpcRoundStore, type RoundStore } from "./round-store";
import { challengeFor } from "./rules";
import { createVerifiedRoundService, judgeSubmissionTiming, type VerifiedRoundService } from "./service";

let t: TestDatabase;
let store: RoundStore;
let service: VerifiedRoundService;
let seedCounter = 0;
const nextSeed = () => `RV1-test-${String(++seedCounter).padStart(8, "0")}-seed`;

beforeAll(async () => {
  t = await createTestDatabase();
  store = createRpcRoundStore(t.serviceRpc);
  service = createVerifiedRoundService({ store, createSeed: nextSeed });
}, 60_000);

let alice: string;
let bob: string;
beforeEach(async () => {
  alice = await t.createUser(`alice-${seedCounter}-${Math.random()}@example.com`, "Alice");
  bob = await t.createUser(`bob-${seedCounter}-${Math.random()}@example.com`, "Bob");
});

async function start(userId = alice) {
  const response = await service.startRound(userId);
  const session = await store.getSession(response.sessionId, userId);
  return { response, challenge: challengeFor(1, session!.seed) };
}

function solutionEntries(challenge: ReturnType<typeof challengeFor>, count = challenge.errors.length) {
  return Object.fromEntries(
    challenge.errors.slice(0, count).map((e) => [cellKey(e.address), challenge.cells.get(cellKey(e.address))!.solution]),
  );
}

/** Moves a session's clock: the round started `elapsedMs` ago (by database time). */
async function age(sessionId: string, elapsedMs: number) {
  await t.admin.query(
    `update public.game_sessions
       set started_at = now() - $2 * interval '1 millisecond',
           deadline_at = now() - $2 * interval '1 millisecond' + interval '90 seconds'
     where id = $1`,
    [sessionId, elapsedMs],
  );
}

async function ledger(userId: string) {
  const { rows } = await t.admin.query<{ n: number; xp: number }>(
    "select count(*)::int as n, coalesce(sum(amount), 0)::int as xp from public.xp_ledger where user_id = $1",
    [userId],
  );
  return rows[0];
}

const expectError = async (promise: Promise<unknown>, code: string) => {
  const error = await promise.then(() => null, (e) => e);
  expect(error).toBeInstanceOf(RoundError);
  expect((error as RoundError).code).toBe(code);
};

describe("starting a verified round", () => {
  it("sends the public puzzle only: no solutions, planted errors or seed", async () => {
    const { response, challenge } = await start();
    const json = JSON.stringify(response);
    expect(json).not.toContain('"solution"');
    expect(json).not.toContain('"errors"');
    expect(json).not.toContain(challenge.seed);
    for (const error of challenge.errors) {
      const answer = challenge.cells.get(cellKey(error.address))!.solution;
      if (answer.startsWith("=")) expect(json).not.toContain(answer);
      expect(json).not.toContain(error.explanation);
    }
    expect(response.challenge).toEqual(JSON.parse(JSON.stringify(serializePublicChallenge(toPublicChallenge(challenge)))));
    expect(response.durationMs).toBe(90_000);
    expect(response.rulesVersion).toBe(1);
  });

  it("uses unguessable server seeds by default", async () => {
    const real = createVerifiedRoundService({ store });
    const { sessionId } = await real.startRound(alice);
    const session = await store.getSession(sessionId, alice);
    expect(session!.seed).toMatch(/^RV1-[0-9a-f]{32}$/);
  });

  it("abandons an unfinished round when a new one starts", async () => {
    const first = await start();
    await start();
    await expectError(service.submitRound(alice, first.response.sessionId, { entries: {} }), "session_closed");
    expect((await ledger(alice)).n).toBe(0);
  });

  it("rate-limits round creation per player", async () => {
    for (let i = 0; i < 12; i++) await service.startRound(bob);
    await expectError(service.startRound(bob), "rate_limited");
  });
});

describe("submitting", () => {
  it("scores the submitted sheet on the server and awards XP from the formula", async () => {
    const { response, challenge } = await start();
    const result = await service.submitRound(alice, response.sessionId, { entries: solutionEntries(challenge) });
    expect(result.created).toBe(true);
    expect(result.record.errorsFixed).toBe(5);
    expect(result.record.completion).toBe("submitted");
    expect(result.record.xpAwarded).toBe(xpForScore(result.record.score));
    expect(result.review!.score.total).toBe(result.record.score);
    expect(result.review!.score.timeBonus).toBeGreaterThan(250);
    expect(await ledger(alice)).toEqual({ n: 1, xp: result.record.xpAwarded });
    expect(result.totalXp).toBe(result.record.xpAwarded);
    // Answers are revealed only now that the round is final.
    expect(result.review!.challenge.errors).toHaveLength(5);
  });

  it("ignores self-reported scores, times, XP and outcomes", async () => {
    const { response } = await start();
    const result = await service.submitRound(alice, response.sessionId, {
      entries: {},
      score: 1050,
      xp: 999,
      xpAwarded: 999,
      completion: "submitted",
      timeRemainingMs: 90_000,
      startedAt: "2000-01-01T00:00:00Z",
      now: "2000-01-01T00:00:01Z",
    });
    expect(result.record.score).toBe(0);
    expect(result.record.xpAwarded).toBe(0);
    expect(result.record.errorsFixed).toBe(0);
  });

  it("returns the stored result for duplicate submissions without awarding XP again", async () => {
    const { response, challenge } = await start();
    const first = await service.submitRound(alice, response.sessionId, { entries: solutionEntries(challenge) });
    const again = await service.submitRound(alice, response.sessionId, { entries: {} }); // different cells, too
    expect(again.created).toBe(false);
    expect(again.record).toEqual(first.record);
    expect(again.review!.evaluation.fixedCount).toBe(5);
    expect(await ledger(alice)).toEqual({ n: 1, xp: first.record.xpAwarded });
  });

  it("finalizes concurrent submissions exactly once", async () => {
    const { response, challenge } = await start();
    const results = await Promise.all([
      service.submitRound(alice, response.sessionId, { entries: solutionEntries(challenge) }),
      service.submitRound(alice, response.sessionId, { entries: solutionEntries(challenge, 2) }),
      service.submitRound(alice, response.sessionId, { entries: {} }),
    ]);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => JSON.stringify(r.record))).size).toBe(1);
    expect((await ledger(alice)).n).toBe(1);
  });

  it("refuses another player's session as if it didn't exist", async () => {
    const { response, challenge } = await start(alice);
    await expectError(service.submitRound(bob, response.sessionId, { entries: solutionEntries(challenge) }), "not_found");
    await expectError(service.requestHint(bob, response.sessionId, { entries: {} }), "not_found");
    expect((await ledger(bob)).n).toBe(0);
    // The owner can still finish normally.
    expect((await service.submitRound(alice, response.sessionId, { entries: {} })).created).toBe(true);
  });

  it("rejects malformed and tampered sheets", async () => {
    const { response, challenge } = await start();
    const editable = [...challenge.cells.values()].find((c) => c.editable)!;
    const locked = [...challenge.cells.values()].find((c) => !c.editable)!;
    const bad: unknown[] = [
      null,
      [],
      "entries",
      { entries: [] },
      { entries: { "not-a-cell": "1" } },
      { entries: { "01:3": "1" } },
      { entries: { "999:99": "1" } },
      { entries: { [cellKey(locked.address)]: "INV-00000" } },
      { entries: { [cellKey(editable.address)]: 42 } },
      { entries: { [cellKey(editable.address)]: "x".repeat(300) } },
    ];
    for (const body of bad) await expectError(service.submitRound(alice, response.sessionId, body), "invalid_payload");
    // Nothing was finalized by the bad requests.
    expect((await service.submitRound(alice, response.sessionId, { entries: {} })).created).toBe(true);
  });

  it("scores unsupported formulas as wrong answers instead of failing", async () => {
    const { response, challenge } = await start();
    const target = challenge.errors[0];
    const result = await service.submitRound(alice, response.sessionId, {
      entries: { [cellKey(target.address)]: "=EVIL(A1); alert(1)" },
    });
    expect(result.record.incorrectCorrections).toBe(1);
    expect(result.review!.evaluation.errors.find((e) => e.error.id === target.id)!.status).toBe("incorrect");
  });
});

describe("deadlines (database time)", () => {
  it("judges timing from server timestamps", () => {
    const startedAt = new Date("2026-10-30T10:00:00Z");
    const deadlineAt = new Date("2026-10-30T10:01:30Z");
    const at = (iso: string) => judgeSubmissionTiming({ startedAt, deadlineAt, toleranceMs: 3_000, dbNow: new Date(iso) });
    expect(at("2026-10-30T10:00:30Z")).toEqual({ completion: "submitted", acceptEntries: true, elapsedMs: 30_000, remainingMs: 60_000 });
    expect(at("2026-10-30T10:01:30Z").completion).toBe("submitted");
    expect(at("2026-10-30T10:01:32Z")).toEqual({ completion: "timedOut", acceptEntries: true, elapsedMs: 90_000, remainingMs: 0 });
    expect(at("2026-10-30T10:01:34Z")).toEqual({ completion: "timedOut", acceptEntries: false, elapsedMs: 90_000, remainingMs: 0 });
  });

  it("scores a submission inside the network tolerance as timed out, without time bonus", async () => {
    const { response, challenge } = await start();
    await age(response.sessionId, 91_500);
    const result = await service.submitRound(alice, response.sessionId, { entries: solutionEntries(challenge) });
    expect(result.record.completion).toBe("timedOut");
    expect(result.record.errorsFixed).toBe(5);
    expect(result.record.timeRemainingMs).toBe(0);
    expect(result.review!.score.timeBonus).toBe(0);
  });

  it("ignores cells submitted after the tolerance", async () => {
    const { response, challenge } = await start();
    await age(response.sessionId, 120_000);
    const result = await service.submitRound(alice, response.sessionId, { entries: solutionEntries(challenge) });
    expect(result.record).toMatchObject({ completion: "timedOut", errorsFixed: 0, score: 0, xpAwarded: 0 });
  });

  it("refuses to finalize a 'submitted' result after the deadline even if asked directly", async () => {
    const { response } = await start();
    await age(response.sessionId, 200_000);
    await expectError(
      store.finalize(response.sessionId, alice, {
        department: "IT", difficulty: "associate", completion: "submitted", score: 500, max_score: 1000, grade: "x",
        errors_fixed: 3, total_errors: 5, incorrect_corrections: 0, accuracy: 1, time_used_ms: 1, time_remaining_ms: 1,
      }, {}),
      "deadline_passed",
    );
  });

  it("derives remaining time from the server clock, not the client", async () => {
    const { response } = await start();
    await age(response.sessionId, 45_000);
    const result = await service.submitRound(alice, response.sessionId, { entries: {}, timeRemainingMs: 90_000 });
    expect(result.record.timeRemainingMs).toBeGreaterThan(44_000);
    expect(result.record.timeRemainingMs).toBeLessThanOrEqual(45_000);
  });
});

describe("Request Assistance (verified)", () => {
  it("gives one hint per round, chosen from the player's current sheet", async () => {
    const { response, challenge } = await start();
    const fixedAllButLast = solutionEntries(challenge, 4);
    const { hint } = await service.requestHint(alice, response.sessionId, { entries: fixedAllButLast });
    expect(hint.errorId).toBe(challenge.errors[4].id);
    expect(hint.row).toBe(challenge.errors[4].address.row);
    // A second request returns the same hint, whatever is sent.
    const again = await service.requestHint(alice, response.sessionId, { entries: {} });
    expect(again.hint).toEqual(hint);
  });

  it("does not leak the answer and has no score penalty", async () => {
    const { response, challenge } = await start();
    const { hint } = await service.requestHint(alice, response.sessionId, { entries: {} });
    const target = challenge.errors.find((e) => e.id === hint.errorId)!;
    expect(hint.message).not.toContain(challenge.cells.get(cellKey(target.address))!.solution);
    const result = await service.submitRound(alice, response.sessionId, { entries: solutionEntries(challenge) });
    expect(result.record.assistanceUsed).toBe(true);
    expect(result.review!.hint).toEqual(hint);
    expect(result.record.xpAwarded).toBe(xpForScore(result.record.score));
    // All fixed early: every correction point plus a time bonus, and no deduction for the hint.
    const fullPoints = challenge.errors.reduce((sum, e) => sum + DIFFICULTY_POINTS[e.difficulty], 0);
    expect(result.review!.score.correctionPoints).toBe(fullPoints);
    expect(result.review!.score.penaltyPoints === 0).toBe(true); // -0 from 50 × 0 is still zero
    expect(result.review!.score.timeBonus).toBeGreaterThan(0);
  });

  it("is unavailable after the deadline and after the round ends", async () => {
    const late = await start();
    await age(late.response.sessionId, 95_000);
    await expectError(service.requestHint(alice, late.response.sessionId, { entries: {} }), "session_closed");

    const done = await start();
    await service.submitRound(alice, done.response.sessionId, { entries: {} });
    await expectError(service.requestHint(alice, done.response.sessionId, { entries: {} }), "session_closed");
  });
});

describe("XP rules", () => {
  it("never pays twice for the same seed", async () => {
    const first = await start();
    await service.submitRound(alice, first.response.sessionId, { entries: solutionEntries(first.challenge) });
    // Seeds are unique per session; simulate a replay by freeing the old seed value.
    await t.arrange("update public.game_sessions set seed = seed || '-original' where id = $1", [first.response.sessionId]);
    const replayService = createVerifiedRoundService({ store, createSeed: () => first.challenge.seed });
    const replay = await replayService.startRound(alice);
    const result = await replayService.submitRound(alice, replay.sessionId, { entries: solutionEntries(first.challenge) });
    expect(result.record.score).toBeGreaterThan(0);
    expect(result.record.xpAwarded).toBe(0);
  });

  it("matches the TypeScript XP formula exactly (1 XP per 20 points, rounded down)", async () => {
    const player = await t.createUser(`formula-${Math.random()}@example.com`);
    for (const fixed of [0, 1, 2, 3, 4, 5]) {
      const { response, challenge } = await start(player);
      const result = await service.submitRound(player, response.sessionId, { entries: solutionEntries(challenge, fixed) });
      expect(result.record.xpAwarded, `fixed ${fixed}`).toBe(xpForScore(result.record.score));
    }
  });

  it("refuses sessions pinned to rules the server can't verify", async () => {
    const { response } = await start();
    await t.admin.query("insert into public.game_rules (game_id, rules_version, duration_ms, tolerance_ms) values ('reconciliation-rush', 99, 90000, 3000) on conflict do nothing");
    await t.arrange("update public.game_sessions set rules_version = 99 where id = $1", [response.sessionId]);
    await expectError(service.submitRound(alice, response.sessionId, { entries: {} }), "unsupported_rules");
    await t.admin.query("update public.game_rules set is_active = false where rules_version = 99");
  });
});
