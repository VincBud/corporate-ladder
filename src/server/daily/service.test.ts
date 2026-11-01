/**
 * Daily Challenges against the real migrations in PGlite: shared puzzles,
 * UTC dates, rules pinning, one ranked attempt (concurrency, retries,
 * resume, expiry), seed and answer protection, scoring, XP and contribution
 * exactly once, careers, achievements, rankings, authorization, account
 * deletion and backend failures.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { DAILY_ASSIGNMENTS } from "@/daily/assignments";
import { solveRound } from "@/games/pipeline-panic/solve";
import { cellKey } from "@/games/spreadsheet-wars/sheet";
import { syncAchievements } from "../achievements/service";
import { selectDepartment } from "../departments/service";
import { createPipelineRoundService, type PipelineRoundService } from "../pipeline/service";
import { pipelineRoundFor } from "../pipeline/rules";
import { RoundError } from "../rounds/errors";
import { createRpcRoundStore } from "../rounds/round-store";
import { challengeFor } from "../rounds/rules";
import { createVerifiedRoundService, type VerifiedRoundService } from "../rounds/service";
import { createTestDatabase, type TestDatabase } from "../testing/test-database";
import { createDailyService, guestOverview, startAfterDailySettlement, type DailyService } from "./service";
import type { DailyStartResponse } from "@/types/daily";

const denied = /permission denied/;
let t: TestDatabase;
let rush: VerifiedRoundService;
let pipeline: PipelineRoundService;
let daily: DailyService;
let seedCounter = 0;

function services(db: TestDatabase) {
  const store = createRpcRoundStore(db.serviceRpc);
  const r = createVerifiedRoundService({ store, createSeed: () => `RV1-daily-${String(++seedCounter).padStart(8, "0")}-seed` });
  const p = createPipelineRoundService({ store, createSeed: () => `PP1-daily-${String(++seedCounter).padStart(8, "0")}-seed` });
  return { rush: r, pipeline: p, daily: createDailyService({ rpc: db.serviceRpc, rush: r, pipeline: p }) };
}

beforeAll(async () => {
  t = await createTestDatabase();
  ({ rush, pipeline, daily } = services(t));
}, 60_000);

const expectCode = async (promise: Promise<unknown>, code: string) => {
  const error = await promise.then(() => null, (e) => e);
  expect(error).toBeInstanceOf(RoundError);
  expect((error as RoundError).code).toBe(code);
};

async function puzzleSeedOf(sessionId: string, db = t) {
  const { rows } = await db.admin.query<{ seed: string }>(
    "select c.seed from public.daily_challenge_attempts a join public.daily_challenges c on c.id = a.challenge_id where a.session_id = $1",
    [sessionId],
  );
  return rows[0]?.seed ?? null;
}

async function sessionSeedOf(sessionId: string, db = t) {
  const { rows } = await db.admin.query<{ seed: string }>("select seed from public.game_sessions where id = $1", [sessionId]);
  return rows[0].seed;
}

async function auditEntries(start: DailyStartResponse, fixed = 5, db = t) {
  const challenge = challengeFor(start.round.rulesVersion, (await puzzleSeedOf(start.round.sessionId, db))!);
  return Object.fromEntries(challenge.errors.slice(0, fixed).map((e) => [cellKey(e.address), challenge.cells.get(cellKey(e.address))!.solution]));
}

async function salesDecisions(start: DailyStartResponse) {
  const round = pipelineRoundFor(start.round.rulesVersion, (await puzzleSeedOf(start.round.sessionId))!);
  return Object.fromEntries(Object.entries(solveRound(round)).map(([id, r]) => [id, r.decision]));
}

async function playAudit(userId: string, fixed = 5, s = { rush, daily }, db = t) {
  const start = await s.daily.start(userId, "daily-audit");
  const result = await s.rush.submitRound(userId, start.round.sessionId, { entries: await auditEntries(start, fixed, db) });
  return { start, result };
}

/** Moves a round's clock into the past (test arrangement, like the live deadline tests). */
async function expire(sessionId: string, elapsedMs = 120_000, db = t) {
  await db.admin.query(
    "update public.game_sessions set started_at = now() - ($2 * interval '1 millisecond'), deadline_at = now() - ($2 * interval '1 millisecond') + interval '90 seconds' where id = $1",
    [sessionId, elapsedMs],
  );
}

const integrity = async (db = t) => (await db.serviceRpc("check_progression_integrity", {})) as Record<string, number>;

describe("assignments and challenges", () => {
  it("defines the same assignments in TypeScript and the database", async () => {
    const { rows } = await t.admin.query("select id, game_id, title, generation_version from public.daily_assignments order by id");
    expect(rows).toEqual(DAILY_ASSIGNMENTS.map((a) => ({ id: a.id, game_id: a.gameId, title: a.title, generation_version: a.generationVersion })).sort((a, b) => a.id.localeCompare(b.id)));
  });

  it("gives every player the same puzzle for the same assignment and UTC day", async () => {
    const ann = await t.createUser("daily-ann@example.com");
    const ben = await t.createUser("daily-ben@example.com");
    const [a, b] = [await daily.start(ann, "daily-audit"), await daily.start(ben, "daily-audit")];
    const today = new Date().toISOString().slice(0, 10);
    expect(a.challengeId).toBe(`daily-audit:${today}`);
    expect(b.challengeId).toBe(a.challengeId);
    expect(b.round.rulesVersion).toBe(a.round.rulesVersion);
    if (a.gameId !== "reconciliation-rush" || b.gameId !== "reconciliation-rush") throw new Error("wrong game");
    expect(b.round.challenge).toEqual(a.round.challenge);
    // One shared puzzle seed, but each session keeps its own unique session seed.
    expect(await puzzleSeedOf(a.round.sessionId)).toBe(await puzzleSeedOf(b.round.sessionId));
    expect(await sessionSeedOf(a.round.sessionId)).not.toBe(await sessionSeedOf(b.round.sessionId));
    expect(await sessionSeedOf(a.round.sessionId)).toMatch(/^DS1-[0-9a-f]{64}$/);
    const sales = await daily.start(await t.createUser("daily-cat@example.com"), "daily-sales-briefing");
    expect(sales.gameId).toBe("pipeline-panic");
    expect(await puzzleSeedOf(sales.round.sessionId)).not.toBe(await puzzleSeedOf(a.round.sessionId));
  });

  it("draws a different secret puzzle for each UTC date, once", async () => {
    await t.admin.query("select public.ensure_daily_challenges((now() at time zone 'UTC')::date - 1)");
    await t.admin.query("select public.ensure_daily_challenges((now() at time zone 'UTC')::date - 1)");
    await t.admin.query("select public.ensure_daily_challenges((now() at time zone 'UTC')::date)");
    const { rows } = await t.admin.query<{ id: string; seed: string; opens_at: Date; closes_at: Date; generation_version: number }>(
      "select id, seed, opens_at, closes_at, generation_version from public.daily_challenges where assignment_id = 'daily-audit' order by challenge_date",
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].seed).not.toBe(rows[1].seed);
    expect(rows[1].seed).toMatch(/^DC1-[0-9a-f]{64}$/);
    for (const row of rows) {
      expect(row.opens_at.toISOString()).toBe(`${row.id.split(":")[1]}T00:00:00.000Z`);
      expect(row.closes_at.getTime() - row.opens_at.getTime()).toBe(86_400_000);
    }
  });
});

describe("one ranked attempt", () => {
  it("reserves the attempt on start, finalizes once and refuses a second attempt", async () => {
    const dan = await t.createUser("daily-dan@example.com");
    const { start, result } = await playAudit(dan, 5);
    expect(start.status).toBe("started");
    expect(result.created).toBe(true);
    expect(result.daily).toMatchObject({ challengeId: start.challengeId, assignmentId: "daily-audit" });
    const again = await rush.submitRound(dan, start.round.sessionId, { entries: {} });
    expect(again.created).toBe(false);
    expect(again.record).toEqual(result.record);
    await expectCode(daily.start(dan, "daily-audit"), "daily_attempt_used");
    // Practice stays unlimited and never serves the daily puzzle.
    const practice = await rush.startRound(dan);
    expect(await puzzleSeedOf(practice.sessionId)).toBeNull();
    expect(practice.challenge).not.toEqual(start.gameId === "reconciliation-rush" ? start.round.challenge : null);
  });

  it("serves concurrent starts the same single round", async () => {
    const eve = await t.createUser("daily-eve@example.com");
    const starts = await Promise.all(Array.from({ length: 6 }, () => daily.start(eve, "daily-sales-briefing")));
    expect(new Set(starts.map((s) => s.round.sessionId)).size).toBe(1);
    expect(starts.filter((s) => s.status === "started")).toHaveLength(1);
    const { rows } = await t.admin.query("select 1 from public.daily_challenge_attempts where user_id = $1", [eve]);
    expect(rows).toHaveLength(1);
  });

  it("resumes the same round with its original clock and hint after a reload", async () => {
    const fay = await t.createUser("daily-fay@example.com");
    const first = await daily.start(fay, "daily-audit");
    await rush.requestHint(fay, first.round.sessionId, { entries: {} });
    const resumed = await daily.start(fay, "daily-audit");
    expect(resumed.status).toBe("resumed");
    expect(resumed.round.sessionId).toBe(first.round.sessionId);
    expect(resumed.round.startedAt).toBe(first.round.startedAt);
    expect(resumed.round.durationMs).toBe(first.round.durationMs);
    expect(Date.parse(resumed.round.serverNow)).toBeGreaterThanOrEqual(Date.parse(first.round.serverNow));
    expect(resumed.hint).not.toBeNull();
  });

  it("never lets another round abandon a running daily round", async () => {
    const gus = await t.createUser("daily-gus@example.com");
    const start = await daily.start(gus, "daily-audit");
    await expectCode(rush.startRound(gus), "daily_in_progress");
    await expectCode(startAfterDailySettlement(daily, gus, () => pipeline.startRound(gus)), "daily_in_progress");
    await expectCode(daily.start(gus, "daily-sales-briefing"), "daily_in_progress");
    const { rows } = await t.admin.query<{ status: string }>("select status from public.game_sessions where id = $1", [start.round.sessionId]);
    expect(rows[0].status).toBe("active");
  });

  it("settles an expired round as an official time-out, which can't be restarted", async () => {
    const hal = await t.createUser("daily-hal@example.com");
    const start = await daily.start(hal, "daily-audit");
    await expire(start.round.sessionId);
    // Starting practice settles the expired daily round first.
    const practice = await startAfterDailySettlement(daily, hal, () => rush.startRound(hal));
    expect(practice.sessionId).not.toBe(start.round.sessionId);
    const view = (await daily.overview(hal)).today.find((c) => c.assignmentId === "daily-audit")!;
    expect(view.state).toBe("timedOut");
    expect(view.attempt?.result).toMatchObject({ completion: "timedOut", score: 0, correct: 0, xpAwarded: 0 });
    await expectCode(daily.start(hal, "daily-audit"), "daily_attempt_used");
    expect((await integrity()).daily_sessions_abandoned).toBe(0);
  });

  it("settles an expired round when the player comes back to Daily Assignments", async () => {
    const ida = await t.createUser("daily-ida@example.com");
    const start = await daily.start(ida, "daily-sales-briefing");
    await expire(start.round.sessionId);
    const view = (await daily.overview(ida)).today.find((c) => c.assignmentId === "daily-sales-briefing")!;
    expect(view.state).toBe("timedOut");
    expect(view.attempt?.result?.completion).toBe("timedOut");
  });

  it("enforces the deadline with server time: late answers aren't scored", async () => {
    const jo = await t.createUser("daily-jo@example.com");
    const start = await daily.start(jo, "daily-audit");
    const entries = await auditEntries(start, 5);
    await expire(start.round.sessionId);
    const late = await rush.submitRound(jo, start.round.sessionId, { entries });
    expect(late.record).toMatchObject({ completion: "timedOut", errorsFixed: 0, score: 0, xpAwarded: 0 });
  });
});

describe("fairness: seeds and answers", () => {
  it("never sends the seeds or answers, and seals the review of daily rounds", async () => {
    const kai = await t.createUser("daily-kai@example.com");
    const start = await daily.start(kai, "daily-audit");
    const puzzle = (await puzzleSeedOf(start.round.sessionId))!;
    const session = await sessionSeedOf(start.round.sessionId);
    const startJson = JSON.stringify(start);
    expect(startJson).not.toContain(puzzle);
    expect(startJson).not.toContain(session);
    expect(startJson).not.toContain('"solution"');
    // Submitting only two corrections must not reveal the other three.
    const result = await rush.submitRound(kai, start.round.sessionId, { entries: await auditEntries(start, 2) });
    expect(result.review).toBeNull();
    const resultJson = JSON.stringify(result);
    expect(resultJson).not.toContain(puzzle);
    expect(resultJson).not.toContain(session);
    expect(resultJson).not.toContain('"solution"');
    const overviewJson = JSON.stringify(await daily.overview(kai));
    expect(overviewJson).not.toContain(puzzle);
    expect(overviewJson).not.toContain(session);
  });

  it("seals Pipeline Panic daily reviews too, and scores the same puzzle identically for everyone", async () => {
    const lea = await t.createUser("daily-lea@example.com");
    const max = await t.createUser("daily-max@example.com");
    const [a, b] = [await daily.start(lea, "daily-sales-briefing"), await daily.start(max, "daily-sales-briefing")];
    const decisions = await salesDecisions(a);
    const [ra, rb] = [
      await pipeline.submitRound(lea, a.round.sessionId, { decisions }),
      await pipeline.submitRound(max, b.round.sessionId, { decisions }),
    ];
    expect(ra.review).toBeNull();
    expect(JSON.stringify(ra)).not.toMatch(/"best"|"explanation"|"resolution"/);
    expect(ra.record).toMatchObject({ errorsFixed: ra.record.totalErrors, incorrectCorrections: 0 });
    expect(rb.record.maxScore).toBe(ra.record.maxScore);
    expect(rb.record.errorsFixed).toBe(ra.record.errorsFixed);
    // Each record carries an opaque reference to its own session seed, not the shared seed.
    expect(ra.record.seed).toMatch(/^ref-/);
    expect(ra.record.seed).not.toBe(rb.record.seed);
  });

  it("keeps the shared seed out of every client-readable table and function", async () => {
    const ned = await t.createUser("daily-ned@example.com");
    const { start } = await playAudit(ned, 5);
    const puzzle = (await puzzleSeedOf(start.round.sessionId))!;
    await expect(t.asUser(ned, (db) => db.query("select * from public.daily_challenges"))).rejects.toThrow(denied);
    await expect(t.asAnon((db) => db.query("select * from public.daily_challenges"))).rejects.toThrow(denied);
    await expect(t.asUser(ned, (db) => db.query("select seed from public.game_sessions"))).rejects.toThrow(denied);
    const ownResults = await t.asUser(ned, (db) => db.query("select * from public.game_results"));
    expect(JSON.stringify(ownResults.rows)).not.toContain(puzzle);
    await expect(t.asUser(ned, (db) => db.query("select public.get_game_session($1, $2)", [start.round.sessionId, ned]))).rejects.toThrow(denied);
    await expect(t.asUser(ned, (db) => db.query("select public.get_daily_status($1, 7)", [ned]))).rejects.toThrow(denied);
    // Even the trusted server reads seeds only through get_game_session.
    await t.db.exec("set role service_role");
    try {
      await expect(t.db.query("select seed from public.daily_challenges")).rejects.toThrow(denied);
    } finally {
      await t.db.exec("reset role");
    }
  });

  it("treats another player's daily round as nonexistent", async () => {
    const ola = await t.createUser("daily-ola@example.com");
    const pia = await t.createUser("daily-pia@example.com");
    const start = await daily.start(ola, "daily-audit");
    await expectCode(rush.resumeRound(pia, start.round.sessionId), "not_found");
    await expectCode(rush.submitRound(pia, start.round.sessionId, { entries: {} }), "not_found");
    await expectCode(rush.requestHint(pia, start.round.sessionId, { entries: {} }), "not_found");
  });
});

describe("rewards and progression", () => {
  it("awards ordinary XP and one contribution event, exactly once", async () => {
    const quinn = await t.createUser("daily-quinn@example.com");
    const { start, result } = await playAudit(quinn, 5);
    await rush.submitRound(quinn, start.round.sessionId, { entries: {} });
    await Promise.all([rush.submitRound(quinn, start.round.sessionId, { entries: {} }), rush.submitRound(quinn, start.round.sessionId, { entries: {} })]);
    expect(result.record.xpAwarded).toBe(Math.floor(result.record.score / 20));
    const { rows: xp } = await t.admin.query<{ amount: number }>("select amount from public.xp_ledger where user_id = $1", [quinn]);
    expect(xp).toEqual([{ amount: result.record.xpAwarded }]);
    const { rows: events } = await t.admin.query("select 1 from public.contribution_events where user_id = $1", [quinn]);
    expect(events).toHaveLength(1);
  });

  it("counts toward the department career and unlocks Daily Grind once", async () => {
    const rio = await t.createUser("daily-rio@example.com");
    await selectDepartment(t.serviceRpc, rio, { departmentId: "controlling", requestId: crypto.randomUUID() });
    const { start } = await playAudit(rio, 5);
    const sync = await syncAchievements(t.serviceRpc, rio);
    expect(sync.created.map((u) => u.id)).toContain("daily-grind");
    expect(sync.summary.progress["climbing-the-ladder"]).toEqual({ current: 1, target: 3 });
    const { rows } = await t.admin.query("select source_type, source_id from public.player_achievements where user_id = $1 and achievement_id = 'daily-grind'", [rio]);
    expect(rows).toEqual([{ source_type: "game_result", source_id: start.round.sessionId }]);
    expect((await syncAchievements(t.serviceRpc, rio)).created).toEqual([]);
  });

  it("doesn't unlock Daily Grind for a timed-out attempt", async () => {
    const sam = await t.createUser("daily-sam@example.com");
    const start = await daily.start(sam, "daily-audit");
    await expire(start.round.sessionId);
    await daily.overview(sam);
    expect((await syncAchievements(t.serviceRpc, sam)).summary.unlocked.map((u) => u.id)).not.toContain("daily-grind");
  });
});

describe("standings and leaderboard", () => {
  it("ranks by score, then time, then assistance, separately per game, without identities", async () => {
    const db = await createTestDatabase();
    const s = services(db);
    const [top, mid, low, qa] = await Promise.all([
      db.createUser("rank-top@example.com"),
      db.createUser("rank-mid@example.com"),
      db.createUser("rank-low@example.com"),
      db.createUser("rank-qa@example.com", undefined, { testAccount: true }),
    ]);
    const lowRun = await playAudit(low, 2, s, db);
    const midRun = await playAudit(mid, 5, s, db);
    const topRun = await playAudit(top, 5, s, db);
    await playAudit(qa, 5, s, db);
    // Same score for top and mid; top used less time.
    await db.arrange("update public.game_results set score = 500, time_used_ms = 40000 where session_id = $1", [midRun.start.round.sessionId]);
    await db.arrange("update public.game_results set score = 500, time_used_ms = 30000 where session_id = $1", [topRun.start.round.sessionId]);
    await db.arrange("update public.game_results set score = 100 where session_id = $1", [lowRun.start.round.sessionId]);

    const board = await s.daily.leaderboard(topRun.start.challengeId, mid);
    expect(board.participants).toBe(3); // the test account isn't ranked
    expect(board.rows.map((r) => [r.rank, r.score, r.timeUsedMs])).toEqual([
      [1, 500, 30000],
      [2, 500, 40000],
      [3, 100, expect.any(Number)],
    ]);
    expect(board.rows.map((r) => r.isViewer)).toEqual([false, true, false]);
    expect(JSON.stringify(board)).not.toMatch(/user_id|@example\.com|rank-/);

    const standing = (await s.daily.overview(mid)).today.find((c) => c.assignmentId === "daily-audit")!.attempt!.standing;
    expect(standing).toEqual({ rank: 2, participants: 3 });
    // A test account sees its own standing among real players.
    expect((await s.daily.overview(qa)).today.find((c) => c.assignmentId === "daily-audit")!.attempt!.standing!.participants).toBe(4);
    // The other game is ranked separately.
    const salesId = (await s.daily.overview(top)).today.find((c) => c.assignmentId === "daily-sales-briefing")!.challengeId;
    expect((await s.daily.leaderboard(salesId, top)).participants).toBe(0);
    await expectCode(s.daily.leaderboard("x'; drop table--", top), "unknown_daily_challenge");
  }, 60_000);
});

describe("overview", () => {
  it("shows guests the schedule only, without creating anything", async () => {
    const before = await t.admin.query("select count(*)::int as n from public.daily_challenges");
    const now = new Date("2026-11-01T23:59:30Z");
    const preview = guestOverview(now);
    expect(preview).toMatchObject({ date: "2026-11-01", nextResetAt: "2026-11-02T00:00:00.000Z", signedIn: false, history: [] });
    expect(preview.today.map((c) => [c.challengeId, c.state, c.attempt])).toEqual([
      ["daily-audit:2026-11-01", null, null],
      ["daily-sales-briefing:2026-11-01", null, null],
    ]);
    expect((await t.admin.query("select count(*)::int as n from public.daily_challenges")).rows).toEqual(before.rows);
    const anonymous = await daily.overview(null);
    expect(anonymous.today.every((c) => c.state === null && c.attempt === null)).toBe(true);
    expect(anonymous.history).toEqual([]);
  });

  it("shows today's states and recent days, with missed days only as information", async () => {
    const uma = await t.createUser("daily-uma@example.com");
    await t.admin.query("select public.ensure_daily_challenges((now() at time zone 'UTC')::date - 1)");
    const start = await daily.start(uma, "daily-audit");
    let overview = await daily.overview(uma);
    expect(overview.today.map((c) => [c.assignmentId, c.state])).toEqual([
      ["daily-audit", "inProgress"],
      ["daily-sales-briefing", "available"],
    ]);
    expect(overview.history.filter((c) => c.date < overview.date).every((c) => c.state === "missed")).toBe(true);
    expect(Date.parse(overview.nextResetAt) - Date.parse(`${overview.date}T00:00:00Z`)).toBe(86_400_000);
    await rush.submitRound(uma, start.round.sessionId, { entries: await auditEntries(start, 5) });
    overview = await daily.overview(uma);
    expect(overview.today[0]).toMatchObject({ state: "completed", attempt: { result: { completion: "submitted", correct: 5, total: 5 } } });
  });

  it("rejects unknown assignments", async () => {
    const vic = await t.createUser("daily-vic@example.com");
    await expectCode(daily.start(vic, "daily-grind"), "unknown_daily_challenge");
    await expectCode(daily.start(vic, { id: "daily-audit" }), "unknown_daily_challenge");
  });
});

describe("cross-midnight rounds", () => {
  it("keeps a round started before midnight in its original day's challenge", async () => {
    const db = await createTestDatabase();
    const s = services(db);
    const wes = await db.createUser("midnight-wes@example.com");
    await db.admin.query("select public.ensure_daily_challenges((now() at time zone 'UTC')::date - 1)");
    // Simulate "started at 23:59:30 yesterday, submitted at 00:00:00": the attempt
    // belongs to yesterday's challenge and is still within its 90-second deadline.
    const { rows } = await db.admin.query<{ id: string }>(
      `insert into public.game_sessions (user_id, game_id, rules_version, seed, started_at, deadline_at)
       values ($1, 'reconciliation-rush', 1, 'DS1-midnight-test-session-seed-0001', now() - interval '30 seconds', now() + interval '60 seconds') returning id`,
      [wes],
    );
    const yesterday = await db.admin.query<{ id: string }>(
      "select id from public.daily_challenges where assignment_id = 'daily-audit' and challenge_date = (now() at time zone 'UTC')::date - 1",
    );
    await db.admin.query("insert into public.daily_challenge_attempts (challenge_id, user_id, session_id) values ($1, $2, $3)", [yesterday.rows[0].id, wes, rows[0].id]);

    const result = await s.rush.submitRound(wes, rows[0].id, { entries: {} });
    expect(result.record.completion).toBe("submitted");
    expect(result.daily?.challengeId).toBe(yesterday.rows[0].id);
    const overview = await s.daily.overview(wes);
    expect(overview.history.find((c) => c.challengeId === yesterday.rows[0].id)?.state).toBe("completed");
    // Today's challenge is a separate, still available attempt.
    expect(overview.today.find((c) => c.assignmentId === "daily-audit")?.state).toBe("available");
    expect((await s.daily.start(wes, "daily-audit")).status).toBe("started");
  }, 60_000);
});

describe("authorization and integrity", () => {
  it("lets players read only their own attempts and nobody write them directly", async () => {
    const xia = await t.createUser("daily-xia@example.com");
    const yan = await t.createUser("daily-yan@example.com");
    const { start } = await playAudit(xia, 3);
    const own = await t.asUser(xia, (db) => db.query<{ challenge_id: string }>("select challenge_id from public.daily_challenge_attempts"));
    expect(own.rows).toEqual([{ challenge_id: start.challengeId }]);
    expect((await t.asUser(yan, (db) => db.query("select * from public.daily_challenge_attempts where user_id = $1", [xia]))).rows).toEqual([]);
    const insert = "insert into public.daily_challenge_attempts (challenge_id, user_id, session_id) values ($1, $2, $3)";
    await expect(t.asUser(yan, (db) => db.query(insert, [start.challengeId, yan, start.round.sessionId]))).rejects.toThrow(denied);
    await expect(t.asUser(yan, (db) => db.query("select public.start_daily_attempt($1, 'daily-audit')", [yan]))).rejects.toThrow(denied);
    await expect(t.asAnon((db) => db.query("select public.get_daily_leaderboard('daily-audit:2026-11-01', 10)"))).rejects.toThrow(denied);
    await t.db.exec("set role service_role");
    try {
      await expect(t.db.query(insert, [start.challengeId, yan, start.round.sessionId])).rejects.toThrow(denied);
    } finally {
      await t.db.exec("reset role");
    }
    expect((await t.asAnon((db) => db.query("select id from public.daily_assignments"))).rows).toHaveLength(2);
  });

  it("keeps challenges immutable and attempts append-only, even for the owner", async () => {
    await expect(t.admin.query("update public.daily_challenges set seed = 'DC1-forged-forged-forged-forged-0001'")).rejects.toThrow(/daily_challenges_immutable/);
    await expect(t.admin.query("delete from public.daily_challenges")).rejects.toThrow(/daily_challenges_immutable/);
    await expect(t.admin.query("delete from public.daily_challenge_attempts")).rejects.toThrow(/append_only/);
    await expect(t.admin.query("truncate public.daily_challenge_attempts")).rejects.toThrow(/append_only/);
    await expect(t.admin.query("update public.daily_assignments set title = 'Renamed'")).rejects.toThrow(/daily_assignments_immutable/);
  });

  it("removes a player's attempts with the account and keeps the challenge", async () => {
    const zed = await t.createUser("daily-zed@example.com");
    const { start } = await playAudit(zed, 5);
    await t.admin.query("delete from auth.users where id = $1", [zed]);
    expect((await t.admin.query("select 1 from public.daily_challenge_attempts where user_id = $1", [zed])).rows).toEqual([]);
    expect((await t.admin.query("select 1 from public.daily_challenges where id = $1", [start.challengeId])).rows).toHaveLength(1);
    expect(Object.values(await integrity()).every((n) => n === 0)).toBe(true);
  });
});

describe("rules pinning", () => {
  it("plays today's challenge under the rules pinned at creation, even after a rules change", async () => {
    const amy = await t.createUser("daily-amy@example.com");
    const pinned = (await t.admin.query<{ rules_version: number }>(
      "select rules_version from public.daily_challenges where assignment_id = 'daily-audit' and challenge_date = (now() at time zone 'UTC')::date",
    )).rows[0].rules_version;
    await t.arrange(
      `insert into public.game_rules (game_id, rules_version, duration_ms, tolerance_ms, xp_score_divisor, max_sessions_per_minute)
       values ('reconciliation-rush', 99, 60000, 3000, 20, 12)`,
    );
    try {
      const start = await daily.start(amy, "daily-audit");
      expect(start.round.rulesVersion).toBe(pinned);
      expect(start.round.durationMs).toBe(90_000);
      // A challenge created after the change pins the new version.
      await t.admin.query("select public.ensure_daily_challenges((now() at time zone 'UTC')::date + 1)");
      const { rows } = await t.admin.query<{ rules_version: number }>(
        "select rules_version from public.daily_challenges where assignment_id = 'daily-audit' and challenge_date = (now() at time zone 'UTC')::date + 1",
      );
      expect(rows[0].rules_version).toBe(99);
    } finally {
      await t.arrange("update public.game_rules set is_active = false where game_id = 'reconciliation-rush' and rules_version = 99");
    }
  });
});

describe("backend failures", () => {
  it("surfaces database failures instead of inventing a state", async () => {
    const broken = createDailyService({
      rpc: async () => {
        throw new Error("connection reset");
      },
      rush,
      pipeline,
    });
    await expect(broken.overview("00000000-0000-4000-8000-000000000001")).rejects.toThrow("connection reset");
    await expect(broken.start("00000000-0000-4000-8000-000000000001", "daily-audit")).rejects.toThrow("connection reset");
    expect(guestOverview(new Date()).today).toHaveLength(2); // the guest preview needs no database
  });
});
