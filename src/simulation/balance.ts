/**
 * Economic balancing audit for the live company (see docs/economy-balance.md).
 *
 * `current` is exactly the production model (liveQuarterConditions).
 * The audit was run with Reconciliation Rush as the only live game
 * (AUDIT_RULES); Pipeline Panic now also feeds Sales, so rerun it with
 * LIVE_GAME_RULES before adopting the proposal.
 * `proposed` is a PROPOSAL FOR REVIEW: nothing in production uses it. Adopting
 * it means switching buildLiveSnapshot to proposedLiveConditions and bumping
 * ECONOMY_MODEL_VERSION.
 *
 * Both run the real engine (computeQuarter) on synthetic, aggregate inputs:
 * how many employees are registered, how many are active, and how many
 * credited points each active employee earned (≤ the 400-point player cap).
 */
import { CONTRIBUTION_RULES } from "./contribution";
import { METRICS, getMetric } from "./departments";
import { computeQuarter, type QuarterConditions, type QuarterResult } from "./economy";
import { RECONCILIATION_RUSH_RULE, type GameContributionRule } from "./games";
import { liveQuarterConditions } from "./live";
import { measuredMetrics } from "./simulate";
import { DEPARTMENT_IDS, type DepartmentId, type PeriodId } from "./types";

export interface LiveScenario {
  registered: number;
  active: number;
  /** Credited points per active employee this quarter (clamped to the player cap). */
  pointsPerActive: number;
}

/**
 * current          production
 * proposed         allocation-aware targets + workforce floor, workforce = registered employees
 * proposedActive   same, but workforce = active employees (dormant accounts don't dilute targets)
 */
export type BalanceModel = "current" | "proposed" | "proposedActive";

/** Proposed parameters. */
export const PROPOSED_BALANCE = {
  /** Targets assume at least this many employees, so a tiny company isn't decided by one round. */
  workforceFloor: 10,
  /** Credited points per employee per quarter that mean 100% attainment, company-wide. */
  pointsPerEmployee: 120,
} as const;

const PERIOD: PeriodId = "2026-Q4";

/** The live configuration the audit (docs/economy-balance.md) was computed for. */
export const AUDIT_RULES: readonly GameContributionRule[] = [RECONCILIATION_RUSH_RULE];

/**
 * PROPOSAL: targets follow where live gameplay actually lands. Each
 * department's target = max(registered, floor) × pointsPerEmployee × its share
 * of live gameplay (from the games' metric weights, assuming an even mix of
 * live games). With Reconciliation Rush alone: Controlling 70%, Finance 30%.
 * `workforceBasis` defaults to registered employees; the proposedActive
 * variant passes active employees instead.
 */
export function proposedLiveConditions(
  periodId: PeriodId,
  registered: number,
  { rules = AUDIT_RULES, workforceBasis = registered }: { rules?: readonly GameContributionRule[]; workforceBasis?: number } = {},
): QuarterConditions {
  const workforce = Math.max(workforceBasis, PROPOSED_BALANCE.workforceFloor);
  const share = Object.fromEntries(DEPARTMENT_IDS.map((id) => [id, 0])) as Record<DepartmentId, number>;
  for (const rule of rules) {
    for (const [metric, weight] of Object.entries(rule.metricWeights)) {
      const department = getMetric(metric)?.departmentId;
      if (department) share[department] += weight / rules.length;
    }
  }
  // The engine multiplies target headcount by each metric's targetPerHead (120).
  const scale = PROPOSED_BALANCE.pointsPerEmployee / METRICS[0].targetPerHead;
  return {
    ...liveQuarterConditions(periodId, registered),
    targetHeadcount: Object.fromEntries(DEPARTMENT_IDS.map((id) => [id, workforce * share[id] * scale])) as Record<DepartmentId, number>,
  };
}

export function evaluateScenario({ registered, active, pointsPerActive }: LiveScenario, model: BalanceModel = "current"): QuarterResult {
  if (active > registered) throw new RangeError("active > registered");
  const points = Math.min(Math.max(pointsPerActive, 0), CONTRIBUTION_RULES.playerHardCap);
  const total = active * points;
  const byMetric: Record<string, number> = {};
  for (const rule of AUDIT_RULES) {
    for (const [metric, weight] of Object.entries(rule.metricWeights)) byMetric[metric] = (byMetric[metric] ?? 0) + (total * weight) / AUDIT_RULES.length;
  }
  const conditions =
    model === "current"
      ? liveQuarterConditions(PERIOD, registered)
      : proposedLiveConditions(PERIOD, registered, { workforceBasis: model === "proposedActive" ? active : registered });
  return computeQuarter(
    conditions,
    { periodId: PERIOD, accepted: [], rejected: [], byMetric, totalRaw: total, totalCredited: total, activeContributors: points > 0 ? active : 0 },
    measuredMetrics(AUDIT_RULES),
  );
}

/** The largest possible operating-profit swing from live play (both models share the same caps). */
export function maximumSwing(): { baseline: number; maximum: number } {
  const baseline = evaluateScenario({ registered: 1, active: 0, pointsPerActive: 0 }).operatingProfit;
  const maximum = evaluateScenario({ registered: 1, active: 1, pointsPerActive: CONTRIBUTION_RULES.playerHardCap }).operatingProfit;
  return { baseline, maximum };
}
