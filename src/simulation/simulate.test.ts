import { describe, expect, it } from "vitest";
import { LIVE_GAME_RULES, PREVIEW_GAME_RULES } from "./games";
import { MILESTONES, evaluateMilestones } from "./milestones";
import { nextPeriod, periodLabel, periodOf, periodRange } from "./periods";
import { simulateCompany, type SimulationInput } from "./simulate";
import { conditions, rushEvent } from "./test-fixtures";
import type { ContributionEvent } from "./types";

const QUARTERS = periodRange("2026-Q1", 3).map((periodId, i) => conditions({ periodId, baseRevenue: 10_000_000 + i * 1_000_000 }));

function input(events: ContributionEvent[], overrides: Partial<SimulationInput> = {}): SimulationInput {
  return { companyId: "test", companyName: "Test Co", provenance: "server-verified", rules: LIVE_GAME_RULES, quarters: QUARTERS, events, ...overrides };
}

const at = (date: string, overrides: Partial<ContributionEvent> = {}) => rushEvent({ completedAt: `${date}T09:00:00.000Z`, ...overrides });

describe("periods", () => {
  it("assigns timestamps to UTC quarters", () => {
    expect(periodOf("2026-03-31T23:59:59.999Z")).toBe("2026-Q1");
    expect(periodOf("2026-04-01T00:00:00.000Z")).toBe("2026-Q2");
    expect(periodOf("2026-12-31T23:59:59.999Z")).toBe("2026-Q4");
    expect(periodOf("not a date")).toBeNull();
  });

  it("steps and labels quarters", () => {
    expect(nextPeriod("2026-Q4")).toBe("2027-Q1");
    expect(periodRange("2025-Q4", 3)).toEqual(["2025-Q4", "2026-Q1", "2026-Q2"]);
    expect(periodLabel("2026-Q3")).toBe("Q3 2026");
  });
});

describe("simulateCompany", () => {
  const events = [
    at("2026-01-10", { eventId: "a1", playerId: "a" }),
    at("2026-02-10", { eventId: "b1", playerId: "b", score: 600 }),
    at("2026-05-10", { eventId: "a2", playerId: "a" }),
    at("2026-08-10", { eventId: "c1", playerId: "c", assisted: true }),
  ];

  it("is deterministic and independent of event order", () => {
    const first = simulateCompany(input(events));
    expect(simulateCompany(input(events))).toEqual(first);
    expect(simulateCompany(input([...events].reverse()))).toEqual(first);
  });

  it("assigns events to their quarter", () => {
    const result = simulateCompany(input(events));
    expect(result.contributions.map((c) => c.accepted.map((e) => e.eventId))).toEqual([["a1", "b1"], ["a2"], ["c1"]]);
    expect(result.quarters.map((q) => q.activeContributors)).toEqual([2, 1, 1]);
  });

  it("rejects seed replays across quarters", () => {
    const result = simulateCompany(input([at("2026-01-10", { eventId: "x1", seed: "S" }), at("2026-04-10", { eventId: "x2", seed: "S" })]));
    expect(result.contributions[1].rejected).toEqual([{ eventId: "x2", reason: "seedReplay" }]);
  });

  it("rejects duplicate event ids across quarters", () => {
    const result = simulateCompany(input([at("2026-01-10", { eventId: "dup", seed: "S1" }), at("2026-04-10", { eventId: "dup", seed: "S2" })]));
    expect(result.contributions[1].rejected).toEqual([{ eventId: "dup", reason: "duplicate" }]);
  });

  it("finalizes closed quarters and keeps the latest one as a draft", () => {
    const { reports } = simulateCompany(input(events));
    expect(reports.map((r) => r.status)).toEqual(["finalized", "finalized", "draft"]);
    expect(reports[0].finalizedAt).toBe("2026-04-01T00:00:00.000Z");
    expect(Object.isFrozen(reports[0])).toBe(true);
    expect(reports[1].growth.revenue).not.toBeNull();
  });

  it("counts events outside every simulated quarter and reports undatable ones as invalid", () => {
    const result = simulateCompany(input([at("2025-06-01", { eventId: "old" }), at("2026-01-02", { eventId: "ok" }), rushEvent({ eventId: "bad", completedAt: "??" })]));
    expect(result.unassignedEvents).toBe(1);
    expect(result.contributions[0].rejected).toEqual([{ eventId: "bad", reason: "invalid" }]);
  });

  it("ignores demo events in live mode", () => {
    const demo = events.map((e) => ({ ...e, provenance: "demo" as const }));
    const result = simulateCompany(input(demo));
    expect(result.quarters.every((q) => q.totalCreditedPoints === 0 && q.revenue === q.baseRevenue)).toBe(true);
    expect(result.reports.every((r) => r.statement.tone === "quiet" && r.source === "server")).toBe(true);
  });

  it("produces quiet, valid reports with no events at all", () => {
    const result = simulateCompany(input([], { provenance: "demo", rules: PREVIEW_GAME_RULES }));
    expect(result.reports.every((r) => r.statement.tone === "quiet" && r.source === "demo")).toBe(true);
    expect(result.quarters.every((q) => Number.isFinite(q.operatingEfficiency))).toBe(true);
    expect(result.milestones.find((m) => m.id === "first-contribution")!.reachedIn).toBeNull();
  });

  it("requires consecutive quarters", () => {
    expect(() => simulateCompany(input([], { quarters: [QUARTERS[0], QUARTERS[2]] }))).toThrow(RangeError);
  });

  it("handles an empty quarter list", () => {
    const result = simulateCompany(input(events, { quarters: [] }));
    expect(result.quarters).toEqual([]);
    expect(result.unassignedEvents).toBe(events.length);
  });
});

describe("evaluateMilestones", () => {
  it("records the first quarter each milestone was reached", () => {
    const { quarters } = simulateCompany(input([at("2026-05-10", { eventId: "first" })]));
    const status = evaluateMilestones(quarters);
    expect(status.find((m) => m.id === "first-contribution")!.reachedIn).toBe("2026-Q2");
    expect(status.find((m) => m.id === "first-profit")!.reachedIn).toBe("2026-Q1");
    expect(status).toHaveLength(MILESTONES.length);
  });

  it("needs three consecutive growth quarters for the growth streak", () => {
    const four = periodRange("2026-Q1", 4).map((periodId, i) => conditions({ periodId, baseRevenue: 10_000_000 + i * 100_000 }));
    const { quarters } = simulateCompany(input([], { quarters: four }));
    expect(evaluateMilestones(quarters.slice(0, 3)).find((m) => m.id === "growth-streak")!.reachedIn).toBeNull();
    expect(evaluateMilestones(quarters).find((m) => m.id === "growth-streak")!.reachedIn).toBe("2026-Q4");
  });
});
