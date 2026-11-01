import { describe, expect, it } from "vitest";
import { CONTRIBUTION_RULES } from "./contribution";
import { STAFFING_PLAN } from "./departments";
import { computeQuarter, type QuarterResult } from "./economy";
import { RECONCILIATION_RUSH_RULE, type GameContributionRule } from "./games";
import { FormulaMismatchError, LIVE_COMPANY, buildLiveSnapshot, liveQuarterConditions, suppressSmallGroups, verifyAllocations, type AllocationRow, type LiveQuarterInput } from "./live";
import { parseCompanySnapshot, type ContributionEventRow } from "./source";
import { LIVE_ALLOCATIONS } from "./test-fixtures";
import { LIVE_GAME_RULES } from "./games";
import { measuredMetrics } from "./simulate";

// Seeded baseline: STAFFING_PLAN payroll (14,208,000) + overhead (2,500,000).
const BASELINE_COSTS = 16_708_000;
const ALLOCATIONS: AllocationRow[] = LIVE_ALLOCATIONS;

let counter = 0;
type Row = ContributionEventRow & { department_id: string | null };

/** A perfect verified round in 2026-Q4 (100 contribution points). */
function row(overrides: Partial<Row> = {}): Row {
  const n = ++counter;
  return {
    id: `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`,
    session_id: `10000000-0000-0000-0000-${String(n).padStart(12, "0")}`,
    user_id: "20000000-0000-0000-0000-000000000001",
    game_id: "reconciliation-rush",
    rules_version: 1,
    seed: `RV1-seed-${n}-xxxxxxxxxxxx`,
    formula_version: 1,
    completed_at: "2026-11-02T10:00:00.000Z",
    period_id: "2026-Q4",
    difficulty: "associate",
    completion: "submitted",
    assisted: false,
    score: 1050,
    max_score: 1050,
    objectives_completed: 5,
    objectives_total: 5,
    mistakes: 0,
    source: "finalize",
    created_at: "2026-11-02T10:00:00.000Z",
    department_id: null,
    ...overrides,
  };
}

const user = (n: number) => `20000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

function input(overrides: Partial<LiveQuarterInput> = {}): LiveQuarterInput {
  const registeredEmployees = overrides.registeredEmployees ?? 1;
  return {
    periodId: "2026-Q4",
    generatedAt: "2026-11-05T12:00:00.000Z",
    registeredEmployees,
    membership: [{ departmentId: null, members: registeredEmployees }],
    events: [],
    allocations: ALLOCATIONS,
    lastContributionAt: null,
    ...overrides,
  };
}

const department = (q: QuarterResult, id: string) => q.departments.find((d) => d.departmentId === id)!;

describe("buildLiveSnapshot", () => {
  it("handles a company with no employees", () => {
    const { snapshot } = buildLiveSnapshot(input({ registeredEmployees: 0, membership: [] }));
    expect(snapshot.dataStatus).toBe("noEmployees");
    expect(snapshot.employees).toMatchObject({ registered: 0, active: 0, contributing: 0, membership: null, activeByDepartment: null });
    expect(snapshot.financials).toMatchObject({ revenue: LIVE_COMPANY.baseRevenue, operatingExpenses: BASELINE_COSTS, operatingEfficiency: 0, participationRate: 0 });
    expect(snapshot.impact).toEqual({ revenue: 0, costSavings: 0, operatingProfit: 0 });
    expect(snapshot.departments.every((d) => !d.measured && d.attainment === null)).toBe(true);
    expect(snapshot.milestones.every((m) => m.reachedIn === null)).toBe(true);
    expect(snapshot.reports).toEqual([]);
  });

  it("stays at the seeded baseline when nobody played this quarter", () => {
    const { snapshot } = buildLiveSnapshot(input({ registeredEmployees: 3 }));
    expect(snapshot.dataStatus).toBe("noActivity");
    expect(snapshot.financials.revenue).toBe(snapshot.baseline.revenue);
    expect(snapshot.financials.operatingExpenses).toBe(snapshot.baseline.operatingExpenses);
    expect(snapshot.baseline).toEqual({ revenue: 16_000_000, operatingExpenses: BASELINE_COSTS, operatingProfit: 16_000_000 - BASELINE_COSTS });
    // Departments fed by a live game have targets (and 0% attainment); the rest aren't measured.
    expect(snapshot.departments.filter((d) => d.measured).map((d) => d.id).sort()).toEqual(["controlling", "finance", "sales"]);
    expect(snapshot.departments.find((d) => d.id === "controlling")).toMatchObject({ attainment: 0, status: "critical" });
    expect(snapshot.departments.find((d) => d.id === "marketing")).toMatchObject({ measured: false, status: "notMeasured" });
  });

  it("computes the financials exactly with the existing engine", () => {
    const { snapshot, quarter } = buildLiveSnapshot(input({ events: [row()], lastContributionAt: "2026-11-02T10:00:00.000Z" }));
    // One employee: Controlling target = 1 × 38/444 × 120 ≈ 10.3 points, Finance ≈ 14.1; 70 and 30 points both cap at 150%.
    expect(department(quarter, "controlling").attainment).toBe(1.5);
    expect(department(quarter, "finance").attainment).toBe(1.5);
    expect(snapshot.financials.revenue).toBe(Math.round(16_000_000 * (1 + 0.01 * 1.25 + 0.01 * 1.25)));
    expect(snapshot.financials.operatingExpenses).toBe(Math.round(BASELINE_COSTS * (1 - (0.015 + 0.012) * 1.25)));
    expect(snapshot.impact.revenue).toBe(400_000);
    expect(snapshot.impact.costSavings).toBe(BASELINE_COSTS - snapshot.financials.operatingExpenses);
    expect(snapshot.impact.operatingProfit).toBe(snapshot.financials.operatingProfit - snapshot.baseline.operatingProfit);
    expect(snapshot.financials.netProfit).toBe(snapshot.financials.operatingProfit - snapshot.financials.tax);
    expect(snapshot.dataStatus).toBe("active");
    expect(snapshot.lastContributionAt).toBe("2026-11-02T10:00:00.000Z");

    const direct = computeQuarter(liveQuarterConditions("2026-Q4", 1), {
      periodId: "2026-Q4",
      accepted: [],
      rejected: [],
      byMetric: { "ledger-integrity": 70, "close-quality": 30 },
      totalRaw: 100,
      totalCredited: 100,
      activeContributors: 1,
    }, measuredMetrics(LIVE_GAME_RULES));
    expect(direct.revenue).toBe(snapshot.financials.revenue);
    expect(direct.operatingExpenses).toBe(snapshot.financials.operatingExpenses);
    expect(direct.operatingEfficiency).toBe(snapshot.financials.operatingEfficiency);
  });

  it("scales targets with registered employees, so the same work matters less in a bigger company", () => {
    const small = buildLiveSnapshot(input({ registeredEmployees: 1, events: [row({ score: 600, objectives_completed: 3 })] })).quarter;
    const large = buildLiveSnapshot(input({ registeredEmployees: 200, events: [row({ score: 600, objectives_completed: 3 })] })).quarter;
    expect(department(large, "controlling").attainment!).toBeLessThan(department(small, "controlling").attainment!);
    expect(large.revenue).toBeLessThan(small.revenue);
    expect(department(large, "controlling").target).toBeCloseTo((200 * STAFFING_PLAN.controlling * 120) / 444, 9);
  });

  it("never treats membership as attribution: departments don't change the company figures", () => {
    const events = [row({ user_id: user(1), department_id: "sales" }), row({ user_id: user(2), department_id: null })];
    const a = buildLiveSnapshot(input({ registeredEmployees: 5, events, membership: [{ departmentId: "sales", members: 3 }, { departmentId: null, members: 2 }] })).snapshot;
    const b = buildLiveSnapshot(input({
      registeredEmployees: 5,
      events: events.map((e) => ({ ...e, department_id: "legal" })),
      membership: [{ departmentId: "legal", members: 5 }],
    })).snapshot;
    expect(a.financials).toEqual(b.financials);
    expect(a.departments).toEqual(b.departments);
    expect(a.departments.find((d) => d.id === "marketing")!.measured).toBe(false);
  });

  it("counts each employee once, including players without a department", () => {
    const events = [
      row({ user_id: user(1), department_id: "finance" }),
      row({ user_id: user(1), department_id: "finance" }),
      row({ user_id: user(1), department_id: "finance" }),
      row({ user_id: user(2), department_id: null }),
      row({ user_id: user(3), department_id: null, score: 0, objectives_completed: 0, mistakes: 3 }),
    ];
    const { snapshot } = buildLiveSnapshot(input({
      registeredEmployees: 14,
      membership: [{ departmentId: "finance", members: 6 }, { departmentId: "legal", members: 5 }, { departmentId: null, members: 3 }],
      events,
    }));
    expect(snapshot.employees).toMatchObject({ registered: 14, active: 3, contributing: 2 });
    expect(snapshot.financials.participationRate).toBe(0.143);
    const members = Object.fromEntries(snapshot.employees.membership!.map((g) => [g.id, g.count]));
    // 3 unassigned is below the minimum group size; Legal (the smallest other group) is withheld too,
    // so the 3 can't be derived from the total.
    expect(members).toMatchObject({ finance: 6, legal: null, unassigned: null, sales: 0 });
    // Only 3 active employees in total: too few to break down at all.
    expect(snapshot.employees.activeByDepartment).toBeNull();
  });

  it("caps each employee's quarter at the player limit", () => {
    const events = Array.from({ length: 9 }, (_, i) => row({ completed_at: `2026-11-0${i + 1}T10:00:00.000Z` }));
    const { quarter } = buildLiveSnapshot(input({ registeredEmployees: 1, events }));
    expect(quarter.totalCreditedPoints).toBe(CONTRIBUTION_RULES.playerHardCap);
  });

  it("ignores duplicates, replays, other quarters and unknown formula versions", () => {
    const first = row({ seed: "RV1-shared-seed-value" });
    const events = [
      first,
      { ...first, id: "dup" },
      row({ seed: "RV1-shared-seed-value", completed_at: "2026-11-03T10:00:00.000Z" }),
      row({ completed_at: "2026-09-30T23:59:59.999Z" }),
      row({ user_id: user(9), formula_version: 2 }),
    ];
    const { quarter, snapshot } = buildLiveSnapshot(input({ registeredEmployees: 9, events }));
    expect(quarter.acceptedEvents).toBe(1);
    expect(quarter.rejectedEvents).toBe(4);
    // The player whose only round used an unknown formula isn't active.
    expect(snapshot.employees.active).toBe(1);
  });

  it("applies each event's own formula version when the server knows several", () => {
    const v2: GameContributionRule = { ...RECONCILIATION_RUSH_RULE, formulaVersion: 2, metricWeights: { "ledger-integrity": 0.5, "close-quality": 0.5 } };
    const allocations = [
      ...ALLOCATIONS,
      { game_id: "reconciliation-rush", formula_version: 2, metric_id: "ledger-integrity", department_id: "controlling", weight_bp: 5000 },
      { game_id: "reconciliation-rush", formula_version: 2, metric_id: "close-quality", department_id: "finance", weight_bp: 5000 },
    ];
    const events = [row({ user_id: user(1), formula_version: 1 }), row({ user_id: user(2), formula_version: 2 })];
    const { quarter, snapshot } = buildLiveSnapshot(input({ registeredEmployees: 500, events, allocations }), [RECONCILIATION_RUSH_RULE, v2]);
    expect(department(quarter, "controlling").creditedPoints).toBe(70 + 50);
    expect(department(quarter, "finance").creditedPoints).toBe(30 + 50);
    expect(snapshot.formulaVersions).toEqual([{ gameId: "reconciliation-rush", formulaVersion: 1 }, { gameId: "reconciliation-rush", formulaVersion: 2 }]);
  });

  it("refuses to compute when the database formula doesn't match the code", () => {
    const changed = ALLOCATIONS.map((a) => (a.metric_id === "close-quality" ? { ...a, weight_bp: 2000 } : a));
    expect(() => buildLiveSnapshot(input({ allocations: changed }))).toThrow(FormulaMismatchError);
    expect(() => verifyAllocations([])).toThrow(/missing/);
    expect(() => verifyAllocations(ALLOCATIONS.map((a) => ({ ...a, department_id: "sales" })))).toThrow(FormulaMismatchError);
  });

  it("rejects impossible counts", () => {
    expect(() => buildLiveSnapshot(input({ registeredEmployees: 1, events: [row({ user_id: user(1) }), row({ user_id: user(2) })] }))).toThrow(RangeError);
    expect(() => buildLiveSnapshot(input({ registeredEmployees: -1 }))).toThrow(RangeError);
  });

  it("is deterministic and independent of row order", () => {
    const events = Array.from({ length: 12 }, (_, i) => row({ user_id: user(i % 4), score: 400 + i * 50, completed_at: `2026-11-1${i % 10}T10:00:00.000Z` }));
    const a = buildLiveSnapshot(input({ registeredEmployees: 10, events }));
    const b = buildLiveSnapshot(input({ registeredEmployees: 10, events: [...events].reverse() }));
    expect(b).toEqual(a);
  });

  it("publishes aggregates only: no player ids, rounds, seeds or raw points", () => {
    const events = [row({ user_id: user(1) }), row({ user_id: user(2) })];
    const { snapshot } = buildLiveSnapshot(input({ registeredEmployees: 6, events }));
    const json = JSON.stringify(snapshot);
    for (const e of events) {
      expect(json).not.toContain(e.user_id);
      expect(json).not.toContain(e.session_id);
      expect(json).not.toContain(e.seed);
      expect(json).not.toContain(e.id);
    }
    for (const key of ["user_id", "userId", "playerId", "session", "seed", "creditedPoints", "rawPoints", "target", "email"]) {
      expect(json).not.toContain(`"${key}"`);
    }
    expect(parseCompanySnapshot(JSON.parse(json))).toEqual(snapshot);
  });
});

describe("suppressSmallGroups", () => {
  it("withholds the whole breakdown below the minimum total", () => {
    expect(suppressSmallGroups([2, 1, 0])).toBeNull();
    expect(suppressSmallGroups([])).toBeNull();
  });

  it("withholds small cells and keeps zeros and large cells", () => {
    expect(suppressSmallGroups([10, 0, 2, 3])).toEqual([10, 0, null, null]);
    expect(suppressSmallGroups([5, 5, 0])).toEqual([5, 5, 0]);
  });

  it("adds a second suppression so a single withheld cell can't be derived from the total", () => {
    expect(suppressSmallGroups([20, 7, 2, 0])).toEqual([20, null, null, 0]);
    // No other non-zero cell to hide: the remaining cell is the total itself.
    expect(suppressSmallGroups([6, 0])).toEqual([6, 0]);
  });
});
