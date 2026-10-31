/**
 * Economic balancing audit. "Current behavior" tests pin down what the
 * production model does today (including the weaknesses the proposal
 * addresses); "proposal" tests describe PROPOSED_BALANCE, which production
 * does not use.
 */
import { describe, expect, it } from "vitest";
import { evaluateScenario, maximumSwing, proposedLiveConditions, type BalanceModel, type LiveScenario } from "./balance";
import { buildLiveSnapshot, liveQuarterConditions } from "./live";

const profit = (s: LiveScenario, model: BalanceModel = "current") => evaluateScenario(s, model).operatingProfit;
const attainment = (s: LiveScenario, department: string, model: BalanceModel = "current") =>
  evaluateScenario(s, model).departments.find((d) => d.departmentId === department)!.attainment;
const { baseline, maximum } = maximumSwing();
const SCALES = [1, 10, 100, 1_000, 100_000];

describe("current behavior (production)", () => {
  it("runs a fixed baseline loss with nobody playing", () => {
    expect(baseline).toBe(16_000_000 - 16_708_000);
    expect(profit({ registered: 0, active: 0, pointsPerActive: 0 })).toBe(baseline);
    expect(profit({ registered: 100_000, active: 0, pointsPerActive: 0 })).toBe(baseline);
  });

  it("is bounded: no amount of play exceeds the ceiling (+2.5% revenue, −3.375% costs)", () => {
    expect(maximum).toBe(Math.round(16_000_000 * 1.025) - Math.round(16_708_000 * (1 - 0.027 * 1.25)));
    for (const registered of SCALES) {
      expect(profit({ registered, active: registered, pointsPerActive: 10_000 })).toBe(maximum);
    }
  });

  it("WEAKNESS: one strong round by a solo employee turns the loss into the maximum profit", () => {
    expect(profit({ registered: 1, active: 1, pointsPerActive: 100 })).toBe(maximum);
    expect(attainment({ registered: 1, active: 1, pointsPerActive: 100 }, "controlling")).toBe(1.5);
  });

  it("WEAKNESS: saturates at low participation, after which more play changes nothing", () => {
    // 1,000 employees, three strong rounds each: 10% participation is already profitable, 30% hits the ceiling.
    expect(profit({ registered: 1_000, active: 100, pointsPerActive: 300 })).toBeGreaterThan(0);
    expect(profit({ registered: 1_000, active: 300, pointsPerActive: 300 })).toBe(maximum);
    expect(profit({ registered: 1_000, active: 1_000, pointsPerActive: 300 })).toBe(maximum);
  });

  it("WEAKNESS: Controlling saturates long before Finance (targets follow staffing, points follow the game)", () => {
    const s = { registered: 1_000, active: 50, pointsPerActive: 300 };
    expect(attainment(s, "controlling")).toBeGreaterThan(1);
    expect(attainment(s, "finance")).toBeLessThan(0.35);
  });

  it("depends on ratios, not absolute size, so it is stable from 10 to 100,000 employees", () => {
    const at = (registered: number) => profit({ registered, active: registered / 10, pointsPerActive: 300 });
    expect(at(10)).toBe(at(1_000));
    expect(at(1_000)).toBe(at(100_000));
  });

  it("never decreases with more participation or more points", () => {
    let last = -Infinity;
    for (let active = 0; active <= 1_000; active += 50) {
      const value = profit({ registered: 1_000, active, pointsPerActive: 200 });
      expect(value).toBeGreaterThanOrEqual(last);
      last = value;
    }
    expect(profit({ registered: 100, active: 10, pointsPerActive: 400 })).toBeGreaterThanOrEqual(profit({ registered: 100, active: 10, pointsPerActive: 100 }));
  });

  it("ignores points above the player cap", () => {
    expect(profit({ registered: 1_000, active: 50, pointsPerActive: 400 })).toBe(profit({ registered: 1_000, active: 50, pointsPerActive: 5_000 }));
  });

  it("matches what production computes", () => {
    expect(proposedLiveConditions("2026-Q4", 7).targetHeadcount).not.toEqual(liveQuarterConditions("2026-Q4", 7).targetHeadcount);
    const { snapshot } = buildLiveSnapshot({
      periodId: "2026-Q4",
      generatedAt: "2026-11-05T12:00:00.000Z",
      registeredEmployees: 1,
      membership: [{ departmentId: null, members: 1 }],
      events: [
        {
          id: "e", session_id: "s", user_id: "u", game_id: "reconciliation-rush", rules_version: 1, seed: "RV1-seed-value-123", formula_version: 1,
          completed_at: "2026-11-02T10:00:00.000Z", period_id: "2026-Q4", difficulty: "associate", completion: "submitted", assisted: false,
          score: 1050, max_score: 1050, objectives_completed: 5, objectives_total: 5, mistakes: 0, source: "finalize", created_at: "2026-11-02T10:00:00.000Z",
          department_id: null,
        },
      ],
      allocations: [
        { game_id: "reconciliation-rush", formula_version: 1, metric_id: "ledger-integrity", department_id: "controlling", weight_bp: 7000 },
        { game_id: "reconciliation-rush", formula_version: 1, metric_id: "close-quality", department_id: "finance", weight_bp: 3000 },
      ],
      lastContributionAt: null,
    });
    expect(snapshot.financials.operatingProfit).toBe(profit({ registered: 1, active: 1, pointsPerActive: 100 }));
  });
});

describe("proposal (not used in production)", () => {
  it("keeps the zero-player baseline and the same ceiling", () => {
    expect(profit({ registered: 0, active: 0, pointsPerActive: 0 }, "proposed")).toBe(baseline);
    expect(profit({ registered: 1_000, active: 1_000, pointsPerActive: 400 }, "proposed")).toBe(maximum);
  });

  it("makes one strong round visible but not decisive in a tiny company", () => {
    const one = profit({ registered: 1, active: 1, pointsPerActive: 100 }, "proposed");
    expect(one).toBeGreaterThan(baseline);
    expect(one - baseline).toBeLessThan(0.1 * (maximum - baseline));
    // Even a solo employee at the player cap can't make the company profitable.
    expect(profit({ registered: 1, active: 1, pointsPerActive: 400 }, "proposed")).toBeLessThan(0);
  });

  it("moves Controlling and Finance together", () => {
    for (const s of [
      { registered: 1_000, active: 50, pointsPerActive: 300 },
      { registered: 10, active: 3, pointsPerActive: 150 },
    ]) {
      expect(attainment(s, "controlling", "proposed")).toBeCloseTo(attainment(s, "finance", "proposed")!, 9);
    }
  });

  it("rewards participation gradually instead of saturating at 30%", () => {
    let last = -Infinity;
    for (let percent = 0; percent <= 50; percent += 5) {
      const value = profit({ registered: 1_000, active: percent * 10, pointsPerActive: 300 }, "proposed");
      expect(value).toBeGreaterThan(last);
      last = value;
    }
    // Break-even needs broad participation: between 30% and 50% of employees playing three strong rounds.
    expect(profit({ registered: 1_000, active: 300, pointsPerActive: 300 }, "proposed")).toBeLessThan(0);
    expect(profit({ registered: 1_000, active: 500, pointsPerActive: 300 }, "proposed")).toBeGreaterThan(0);
  });

  it("is scale-invariant above the workforce floor", () => {
    const at = (registered: number) => profit({ registered, active: registered / 5, pointsPerActive: 300 }, "proposed");
    expect(at(100)).toBe(at(1_000));
    expect(at(1_000)).toBe(at(100_000));
  });

  it("variant: an active-employee workforce ignores dormant accounts but also stops rewarding participation", () => {
    const few = { registered: 100_000, active: 1_000, pointsPerActive: 300 };
    expect(profit(few, "proposedActive")).toBe(maximum);
    expect(profit(few, "proposed")).toBeLessThan(0);
  });

  it("derives targets from the live games' allocation", () => {
    const conditions = proposedLiveConditions("2026-Q4", 100);
    expect(conditions.targetHeadcount!.controlling).toBeCloseTo(70, 9);
    expect(conditions.targetHeadcount!.finance).toBeCloseTo(30, 9);
    expect(conditions.targetHeadcount!.sales).toBe(0);
    expect(proposedLiveConditions("2026-Q4", 2).targetHeadcount!.controlling).toBeCloseTo(7, 9); // floor of 10 × 70%
  });
});
