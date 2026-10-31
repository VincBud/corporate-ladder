import { describe, expect, it } from "vitest";
import { computeQuarter, type QuarterResult } from "./economy";
import type { MilestoneStatus } from "./milestones";
import { buildEarningsReport, finalizeEarningsReport, statementTone } from "./report";
import { ALL_METRICS, conditions, contributionsWith } from "./test-fixtures";

function quarter(overrides: Parameters<typeof conditions>[0] = {}, byMetric: Record<string, number> = { "ledger-integrity": 600 }): QuarterResult {
  return computeQuarter(conditions(overrides), contributionsWith(byMetric, 5, overrides.periodId), ALL_METRICS);
}

const build = (current: QuarterResult, previous: QuarterResult | null = null, milestones: MilestoneStatus[] = []) =>
  buildEarningsReport({ companyId: "test", companyName: "Test Co", quarter: current, previous, milestones, source: "demo" });

describe("buildEarningsReport", () => {
  it("copies the quarter's figures and labels the period", () => {
    const q = quarter();
    const report = build(q);
    expect(report).toMatchObject({
      reportId: "test:2026-Q3:m1",
      periodLabel: "Q3 2026",
      status: "draft",
      finalizedAt: null,
      source: "demo",
      revenue: q.revenue,
      operatingExpenses: q.operatingExpenses,
      operatingProfit: q.revenue - q.operatingExpenses,
      profitMargin: q.profitMargin,
      netProfit: q.netProfit,
    });
  });

  it("computes growth against the previous quarter", () => {
    const previous = quarter({ periodId: "2026-Q2", baseRevenue: 8_000_000 });
    const current = quarter({ baseRevenue: 10_000_000 });
    const report = build(current, previous);
    expect(report.growth.revenue).toBeCloseTo((current.revenue - previous.revenue) / previous.revenue, 12);
    expect(report.growth.operatingProfit).toBe(current.operatingProfit - previous.operatingProfit);
    expect(report.growth.margin).toBeCloseTo(current.profitMargin! - previous.profitMargin!, 12);
  });

  it("leaves growth empty without a usable previous quarter", () => {
    expect(build(quarter()).growth).toEqual({ revenue: null, operatingProfit: null, margin: null });
    const zeroRevenue = quarter({ periodId: "2026-Q2", baseRevenue: 0 });
    const report = build(quarter(), zeroRevenue);
    expect(report.growth.revenue).toBeNull();
    expect(report.growth.margin).toBeNull();
    expect(report.growth.operatingProfit).not.toBeNull();
  });

  it("lists departments by contribution and only milestones reached this quarter", () => {
    const q = quarter({}, { "pipeline-health": 900, "ledger-integrity": 300 });
    const report = build(q, null, [
      { id: "now", title: "Now", description: "", reachedIn: "2026-Q3" },
      { id: "before", title: "Before", description: "", reachedIn: "2026-Q2" },
      { id: "never", title: "Never", description: "", reachedIn: null },
    ]);
    expect(report.departments.slice(0, 2).map((d) => d.departmentId)).toEqual(["sales", "controlling"]);
    expect(report.departments[0].share).toBeCloseTo(0.75, 12);
    expect(report.milestones).toEqual([{ id: "now", title: "Now" }]);
  });

  it("writes the same statement for the same report and fills every placeholder", () => {
    const q = quarter();
    expect(build(q).statement).toEqual(build(q).statement);
    expect(build(q).statement.text).not.toMatch(/[{}]/);
    expect(build(q).statement.signedBy).toBe("Office of the CEO");
  });
});

describe("statementTone", () => {
  const base = quarter();
  it("is quiet when nobody contributed", () => {
    expect(statementTone({ ...base, totalCreditedPoints: 0 }, 0.5)).toBe("quiet");
  });
  it("reports losses", () => {
    expect(statementTone({ ...base, operatingProfit: -1, profitMargin: -0.01 }, 0.2)).toBe("loss");
  });
  it("celebrates growth with a healthy margin", () => {
    expect(statementTone({ ...base, operatingProfit: 1, profitMargin: 0.2 }, 0.06)).toBe("record");
  });
  it("notes falling revenue", () => {
    expect(statementTone({ ...base, operatingProfit: 1, profitMargin: 0.2 }, -0.01)).toBe("soft");
  });
  it("distinguishes strong and steady quarters", () => {
    expect(statementTone({ ...base, operatingProfit: 1, profitMargin: 0.12 }, null)).toBe("strong");
    expect(statementTone({ ...base, operatingProfit: 1, profitMargin: 0.05 }, 0.01)).toBe("steady");
  });
});

describe("finalizeEarningsReport", () => {
  it("returns a deeply frozen copy and leaves the draft untouched", () => {
    const draft = build(quarter());
    const final = finalizeEarningsReport(draft, "2026-10-01T00:00:00.000Z");
    expect(final.status).toBe("finalized");
    expect(final.finalizedAt).toBe("2026-10-01T00:00:00.000Z");
    expect(draft.status).toBe("draft");
    expect(Object.isFrozen(final)).toBe(true);
    expect(Object.isFrozen(final.departments[0])).toBe(true);
    expect(Object.isFrozen(final.growth)).toBe(true);
    expect(() => {
      (final as { revenue: number }).revenue = 1;
    }).toThrow(TypeError);
  });

  it("refuses to finalize twice or with an invalid timestamp", () => {
    const draft = build(quarter());
    const final = finalizeEarningsReport(draft, "2026-10-01T00:00:00.000Z");
    expect(() => finalizeEarningsReport(final, "2026-10-02T00:00:00.000Z")).toThrow(/already finalized/);
    expect(() => finalizeEarningsReport(draft, "not a date")).toThrow(RangeError);
  });
});
