import { describe, expect, it } from "vitest";
import type { GameResultRecord } from "@/types/progression";
import { buildLiveSnapshot } from "./live";
import {
  contributionEventFromRow,
  contributionEventFromVerifiedResult,
  parseCompanySnapshot,
  type ContributionEventRow,
} from "./source";
import { liveAggregate } from "./test-fixtures";

const record: GameResultRecord = {
  id: "session-1",
  gameId: "reconciliation-rush",
  scoringVersion: 1,
  seed: "RV1-abc",
  department: "Marketing",
  difficulty: "associate",
  completedAt: "2026-08-03T10:00:00.000Z",
  completion: "submitted",
  score: 850,
  maxScore: 1050,
  grade: "A",
  errorsFixed: 4,
  totalErrors: 5,
  incorrectCorrections: 1,
  accuracy: 0.8,
  timeUsedMs: 60_000,
  timeRemainingMs: 30_000,
  assistanceUsed: true,
  xpAwarded: 42,
};

describe("contributionEventFromVerifiedResult", () => {
  it("maps verified result fields", () => {
    expect(contributionEventFromVerifiedResult(record, "user-1")).toEqual({
      eventId: "session-1",
      playerId: "user-1",
      gameId: "reconciliation-rush",
      scoringVersion: 1,
      difficulty: "associate",
      seed: "RV1-abc",
      completedAt: "2026-08-03T10:00:00.000Z",
      score: 850,
      maxScore: 1050,
      objectivesCompleted: 4,
      objectivesTotal: 5,
      mistakes: 1,
      completion: "submitted",
      assisted: true,
      provenance: "server-verified",
    });
  });

  it("ignores XP entirely", () => {
    const a = contributionEventFromVerifiedResult({ ...record, xpAwarded: 0 }, "user-1");
    const b = contributionEventFromVerifiedResult({ ...record, xpAwarded: 99_999 }, "user-1");
    expect(a).toEqual(b);
    expect(liveAggregate([a]).contributions).toEqual(liveAggregate([b]).contributions);
  });

  it("does not treat the ledger's business category as department membership", () => {
    const { contributions } = liveAggregate([contributionEventFromVerifiedResult(record, "user-1")]);
    expect(contributions.byMetric["campaign-effectiveness"]).toBe(0);
    expect(contributions.byMetric["ledger-integrity"]).toBeGreaterThan(0);
  });
});

describe("contributionEventFromRow", () => {
  const row: ContributionEventRow = {
    id: "event-1",
    session_id: "session-1",
    user_id: "user-1",
    game_id: "reconciliation-rush",
    rules_version: 1,
    seed: "RV1-abc",
    formula_version: 1,
    completed_at: "2026-08-03 10:00:00+00",
    period_id: "2026-Q3",
    difficulty: "associate",
    completion: "submitted",
    assisted: true,
    score: 850,
    max_score: 1050,
    objectives_completed: 4,
    objectives_total: 5,
    mistakes: 1,
    source: "finalize",
    created_at: "2026-08-03 10:00:00+00",
  };

  it("uses the round id as the event id and pins the formula version", () => {
    const event = contributionEventFromRow(row);
    expect(event).toEqual({ ...contributionEventFromVerifiedResult(record, "user-1"), formulaVersion: 1 });
    expect(event.completedAt).toBe("2026-08-03T10:00:00.000Z");
  });

  it("accepts Date timestamps from database drivers", () => {
    expect(contributionEventFromRow({ ...row, completed_at: new Date("2026-08-03T10:00:00Z") }).completedAt).toBe("2026-08-03T10:00:00.000Z");
  });
});

describe("parseCompanySnapshot", () => {
  const { snapshot } = buildLiveSnapshot({
    periodId: "2026-Q4",
    generatedAt: "2026-11-05T12:00:00.000Z",
    registeredEmployees: 2,
    membership: [{ departmentId: null, members: 2 }],
    events: [],
    allocations: [
      { game_id: "reconciliation-rush", formula_version: 1, metric_id: "ledger-integrity", department_id: "controlling", weight_bp: 7000 },
      { game_id: "reconciliation-rush", formula_version: 1, metric_id: "close-quality", department_id: "finance", weight_bp: 3000 },
    ],
    lastContributionAt: null,
  });
  const valid = JSON.parse(JSON.stringify(snapshot));

  it("accepts a well-formed server snapshot", () => {
    expect(parseCompanySnapshot(structuredClone(valid))).toEqual(snapshot);
  });

  it.each([
    ["not an object", null],
    ["an array", []],
    ["another schema version", { ...valid, schemaVersion: 2 }],
    ["data not marked fictional", { ...valid, fictional: false }],
    ["an unknown data status", { ...valid, dataStatus: "great" }],
    ["a demo report", { ...valid, reports: [{ reportId: "x", status: "finalized", source: "demo", finalizedAt: "2026-10-01", periodId: "2026-Q3", revenue: 1, operatingProfit: 1 }] }],
    ["a draft report", { ...valid, reports: [{ reportId: "x", status: "draft", source: "server", finalizedAt: null, periodId: "2026-Q3", revenue: 1, operatingProfit: 1 }] }],
    ["an invalid period", { ...valid, period: { ...valid.period, id: "2026-Q5" } }],
    ["an invalid timestamp", { ...valid, generatedAt: "soon" }],
    ["more active than registered employees", { ...valid, employees: { ...valid.employees, active: 3 } }],
    ["negative counts", { ...valid, employees: { ...valid.employees, registered: -1 } }],
    ["fractional group counts", { ...valid, employees: { ...valid.employees, membership: [{ id: "x", name: "X", count: 1.5 }] } }],
    ["non-numeric revenue", { ...valid, financials: { ...valid.financials, revenue: "lots" } }],
    ["a malformed department", { ...valid, departments: [{ id: "finance" }] }],
    ["missing milestones", { ...valid, milestones: undefined }],
  ])("rejects %s", (_, value) => {
    expect(parseCompanySnapshot(value)).toBeNull();
  });
});
