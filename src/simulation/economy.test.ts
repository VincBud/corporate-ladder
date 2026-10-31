import { describe, expect, it } from "vitest";
import { ECONOMY_RULES, attainmentEffect, balanceOf, computeQuarter, departmentStatus } from "./economy";
import { LIVE_GAME_RULES } from "./games";
import { measuredMetrics } from "./simulate";
import { ALL_METRICS, conditions, contributionsWith, uniformHeadcount } from "./test-fixtures";

// 10 employees per department: payroll 2,210,000 + overhead 2,500,000.
const BASE_COSTS = 4_710_000;
const BASE_REVENUE = 10_000_000;

describe("computeQuarter", () => {
  it("runs at base revenue and costs with zero participation", () => {
    const q = computeQuarter(conditions(), contributionsWith({}), ALL_METRICS);
    expect(q.revenue).toBe(BASE_REVENUE);
    expect(q.operatingExpenses).toBe(BASE_COSTS);
    expect(q.operatingProfit).toBe(BASE_REVENUE - BASE_COSTS);
    expect(q.profitMargin).toBeCloseTo((BASE_REVENUE - BASE_COSTS) / BASE_REVENUE, 12);
    expect(q.tax).toBe(Math.round((BASE_REVENUE - BASE_COSTS) * ECONOMY_RULES.taxRate));
    expect(q.netProfit).toBe(q.operatingProfit - q.tax);
    expect(q.employeeCount).toBe(70);
    expect(q.operatingEfficiency).toBe(0);
    expect(q.participationRate).toBe(0);
    expect(q.balanceScore).toBe(0);
    expect(q.departments.every((d) => d.attainment === 0 && d.status === "critical")).toBe(true);
    expect(q.departments.every((d) => d.contributionShare === 0)).toBe(true);
  });

  it("adds a metric's revenue lift at 100% attainment", () => {
    // Sales target: 10 heads × 120 points.
    const q = computeQuarter(conditions(), contributionsWith({ "pipeline-health": 1200 }), ALL_METRICS);
    expect(q.revenue).toBe(10_600_000);
    expect(q.operatingExpenses).toBe(BASE_COSTS);
    const sales = q.departments.find((d) => d.departmentId === "sales")!;
    expect(sales).toMatchObject({ attainment: 1, status: "onTarget", revenueImpact: 600_000, costSavings: 0, contributionShare: 1 });
  });

  it("applies cost savings and halves the effect above target", () => {
    const q = computeQuarter(conditions(), contributionsWith({ "ledger-integrity": 1800 }), ALL_METRICS);
    expect(q.revenue).toBe(Math.round(BASE_REVENUE * (1 + 0.01 * 1.25)));
    expect(q.operatingExpenses).toBe(Math.round(BASE_COSTS * (1 - 0.015 * 1.25)));
    expect(q.departments.find((d) => d.departmentId === "controlling")!.attainment).toBe(1.5);
  });

  it("caps attainment so no amount of activity breaks the economy", () => {
    const flood = Object.fromEntries([...ALL_METRICS].map((id) => [id, 1e12]));
    const q = computeQuarter(conditions(), contributionsWith(flood, 70), ALL_METRICS);
    expect(q.revenue).toBe(Math.round(BASE_REVENUE * (1 + 0.18 * 1.25)));
    expect(q.operatingExpenses).toBe(Math.round(BASE_COSTS * (1 - 0.06 * 1.25)));
    expect(q.departments.every((d) => d.attainment === 1.5 && d.status === "exceeding")).toBe(true);
    expect(q.operatingEfficiency).toBe(100);
  });

  it("normalizes attainment by department size", () => {
    const small = computeQuarter(conditions(), contributionsWith({ "ledger-integrity": 600 }), ALL_METRICS);
    const large = computeQuarter(
      conditions({ headcount: { ...uniformHeadcount(10), controlling: 20 } }),
      contributionsWith({ "ledger-integrity": 600 }),
      ALL_METRICS,
    );
    const attainment = (q: typeof small) => q.departments.find((d) => d.departmentId === "controlling")!.attainment;
    expect(attainment(small)).toBe(0.5);
    expect(attainment(large)).toBe(0.25);
  });

  it("marks departments without a supporting game as not measured", () => {
    const q = computeQuarter(conditions(), contributionsWith({ "ledger-integrity": 1200, "close-quality": 1200 }, 14), measuredMetrics(LIVE_GAME_RULES));
    const measured = q.departments.filter((d) => d.measured).map((d) => d.departmentId);
    expect(measured.sort()).toEqual(["controlling", "finance"]);
    expect(q.departments.find((d) => d.departmentId === "sales")).toMatchObject({ attainment: null, status: "notMeasured", revenueImpact: 0 });
    expect(q.balanceScore).toBe(1);
    expect(q.executionScore).toBe(1);
  });

  it("re-weights efficiency when balance doesn't apply", () => {
    const q = computeQuarter(conditions(), contributionsWith({ "ledger-integrity": 1200 }, 14), new Set(["ledger-integrity"]));
    expect(q.balanceScore).toBeNull();
    // (0.5 · 1 + 0.3 · 0.2) / 0.8
    expect(q.operatingEfficiency).toBe(70);
  });

  it("returns a null margin and no tax when revenue is zero", () => {
    const q = computeQuarter(conditions({ baseRevenue: 0 }), contributionsWith({}), ALL_METRICS);
    expect(q.revenue).toBe(0);
    expect(q.profitMargin).toBeNull();
    expect(q.operatingProfit).toBe(-BASE_COSTS);
    expect(q.tax).toBe(0);
    expect(q.netProfit).toBe(-BASE_COSTS);
  });

  it("handles a company with no employees", () => {
    const q = computeQuarter(conditions({ headcount: uniformHeadcount(0) }), contributionsWith({ "ledger-integrity": 500 }, 3), ALL_METRICS);
    expect(q.employeeCount).toBe(0);
    expect(q.participationRate).toBe(0);
    expect(q.operatingExpenses).toBe(ECONOMY_RULES.fixedOverhead);
    expect(q.departments.every((d) => !d.measured)).toBe(true);
    expect(Number.isFinite(q.operatingEfficiency)).toBe(true);
  });

  it("caps participation at 100%", () => {
    const q = computeQuarter(conditions(), contributionsWith({}, 500), ALL_METRICS);
    expect(q.participationRate).toBe(1);
  });

  it("applies strategic decision modifiers", () => {
    const q = computeQuarter(
      conditions({ modifiers: [{ id: "office", label: "Regional office", revenueMultiplier: 1.1, costMultiplier: 1.2 }] }),
      contributionsWith({}),
      ALL_METRICS,
    );
    expect(q.revenue).toBe(11_000_000);
    expect(q.operatingExpenses).toBe(Math.round(BASE_COSTS * 1.2));
    expect(q.modifiers).toHaveLength(1);
  });

  it("scales costs with the cost index", () => {
    const q = computeQuarter(conditions({ costIndex: 1.1 }), contributionsWith({}), ALL_METRICS);
    expect(q.operatingExpenses).toBe(Math.round(BASE_COSTS * 1.1));
  });

  it("produces contribution shares that sum to 1", () => {
    const q = computeQuarter(conditions(), contributionsWith({ "ledger-integrity": 300, "pipeline-health": 500, "close-quality": 200 }), ALL_METRICS);
    expect(q.departments.reduce((sum, d) => sum + d.contributionShare, 0)).toBeCloseTo(1, 12);
  });

  it.each([
    ["negative revenue", { baseRevenue: -1 }],
    ["NaN revenue", { baseRevenue: Number.NaN }],
    ["infinite revenue", { baseRevenue: Number.POSITIVE_INFINITY }],
    ["zero cost index", { costIndex: 0 }],
    ["fractional headcount", { headcount: { ...uniformHeadcount(10), sales: 2.5 } }],
    ["negative headcount", { headcount: { ...uniformHeadcount(10), sales: -1 } }],
    ["negative modifier", { modifiers: [{ id: "x", label: "x", costMultiplier: -1 }] }],
  ])("rejects invalid conditions: %s", (_, overrides) => {
    expect(() => computeQuarter(conditions(overrides), contributionsWith({}), ALL_METRICS)).toThrow(RangeError);
  });
});

describe("attainmentEffect", () => {
  it.each([
    [-1, 0],
    [0, 0],
    [0.5, 0.5],
    [1, 1],
    [1.2, 1.1],
    [1.5, 1.25],
    [9, 1.25],
  ])("maps %d to %d", (attainment, effect) => {
    expect(attainmentEffect(attainment)).toBeCloseTo(effect, 12);
  });
});

describe("balanceOf", () => {
  it("is 1 for perfectly even departments and lower for uneven ones", () => {
    expect(balanceOf([0.8, 0.8, 0.8])).toBeCloseTo(1, 12);
    expect(balanceOf([1.5, 1.5, 0.1, 0.1])!).toBeLessThan(0.2);
    expect(balanceOf([1, 0.9, 1.1])!).toBeGreaterThan(0.9);
  });

  it("handles boundaries", () => {
    expect(balanceOf([])).toBeNull();
    expect(balanceOf([1])).toBeNull();
    expect(balanceOf([0, 0])).toBe(0);
    expect(balanceOf([1.5, 0])).toBe(0);
  });
});

describe("departmentStatus", () => {
  it.each([
    [null, "notMeasured"],
    [0, "critical"],
    [0.49, "critical"],
    [0.5, "below"],
    [0.89, "below"],
    [0.9, "onTarget"],
    [1.09, "onTarget"],
    [1.1, "exceeding"],
  ] as const)("maps %s to %s", (attainment, status) => {
    expect(departmentStatus(attainment)).toBe(status);
  });
});
