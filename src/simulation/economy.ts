/**
 * Quarterly economics. Pure and deterministic; all money is whole CB.
 *
 *   Metric target       = department target headcount × metric.targetPerHead
 *                         (target headcount defaults to headcount; the live company uses a staffing plan)
 *   Metric attainment a = min(1.5, credited points / target)      (unmeasured: no game feeds it)
 *   Effect e(a)         = a up to 1, then half rate: 1 + (a − 1) · 0.5     (max 1.25)
 *
 *   Revenue             = baseRevenue × (1 + Σ revenueLift · e(a)) × Π decision revenue multipliers
 *   Base costs          = (Σ headcount × costPerHead + fixed overhead) × costIndex
 *   Operating expenses  = base costs × (1 − Σ costSaving · e(a)) × Π decision cost multipliers
 *   Operating profit    = revenue − operating expenses
 *   Profit margin       = operating profit / revenue   (null when revenue is 0)
 *   Net profit          = operating profit − 25% tax on positive profit
 *
 *   Department attainment = mean of its measured metrics' attainment
 *   Execution     = headcount-weighted mean of min(1, department attainment)
 *   Participation = min(1, active contributors / employees)
 *   Balance       = 1 − (std. deviation / mean) of department attainment, clamped to [0, 1]
 *                   (needs two measured departments; 0 when nobody contributed)
 *   Operating efficiency (0–100) = 100 × (0.5 · execution + 0.3 · participation + 0.2 · balance)
 *                   (weights are re-normalized when balance doesn't apply)
 *
 * With no contributions the company runs at its base revenue and base costs:
 * nothing breaks, it just doesn't improve.
 */
import { DEPARTMENTS, METRICS, getDepartment } from "./departments";
import type { PeriodContributions } from "./contribution";
import type { DepartmentId, PeriodId } from "./types";

/** Bump when a formula changes, so stored reports are never recomputed under new rules. */
export const ECONOMY_MODEL_VERSION = 1;

export const ECONOMY_RULES = {
  fixedOverhead: 2_500_000,
  maxAttainment: 1.5,
  overshootRate: 0.5,
  taxRate: 0.25,
  efficiencyWeights: { execution: 0.5, participation: 0.3, balance: 0.2 },
} as const;

/** A future strategic decision's effect on one quarter. Not player-selectable yet. */
export interface StrategicModifier {
  id: string;
  label: string;
  revenueMultiplier?: number;
  costMultiplier?: number;
}

export interface QuarterConditions {
  periodId: PeriodId;
  /** Roles per department: drives payroll costs and, by default, targets. */
  headcount: Readonly<Record<DepartmentId, number>>;
  /**
   * Workload basis for metric targets, if different from headcount (may be
   * fractional, e.g. registered players × staffing-plan share).
   */
  targetHeadcount?: Readonly<Record<DepartmentId, number>>;
  /** Employees for participation and the reported employee count (default: total headcount). */
  employees?: number;
  /** Revenue before any contribution effects (CB). */
  baseRevenue: number;
  /** Cost level relative to the model's base (1 = base). */
  costIndex: number;
  modifiers?: readonly StrategicModifier[];
}

export type DepartmentStatus = "exceeding" | "onTarget" | "below" | "critical" | "notMeasured";

export interface MetricResult {
  metricId: string;
  measured: boolean;
  creditedPoints: number;
  target: number;
  attainment: number | null;
}

export interface DepartmentResult {
  departmentId: DepartmentId;
  headcount: number;
  measured: boolean;
  /** 0–1.5, or null when not measured. */
  attainment: number | null;
  status: DepartmentStatus;
  creditedPoints: number;
  target: number;
  /** Share of all credited points this quarter (0 when there were none). */
  contributionShare: number;
  /** Revenue added by this department's metrics (CB). */
  revenueImpact: number;
  /** Costs saved by this department's metrics (CB). */
  costSavings: number;
  metrics: MetricResult[];
}

export interface QuarterResult {
  periodId: PeriodId;
  modelVersion: number;
  employeeCount: number;
  baseRevenue: number;
  revenue: number;
  operatingExpenses: number;
  operatingProfit: number;
  profitMargin: number | null;
  tax: number;
  netProfit: number;
  /** 0–100, one decimal. */
  operatingEfficiency: number;
  participationRate: number;
  executionScore: number;
  balanceScore: number | null;
  activeContributors: number;
  acceptedEvents: number;
  rejectedEvents: number;
  totalCreditedPoints: number;
  departments: DepartmentResult[];
  modifiers: StrategicModifier[];
}

export function departmentStatus(attainment: number | null): DepartmentStatus {
  if (attainment === null) return "notMeasured";
  if (attainment >= 1.1) return "exceeding";
  if (attainment >= 0.9) return "onTarget";
  if (attainment >= 0.5) return "below";
  return "critical";
}

export function attainmentEffect(attainment: number): number {
  const a = Math.min(Math.max(attainment, 0), ECONOMY_RULES.maxAttainment);
  return a <= 1 ? a : 1 + (a - 1) * ECONOMY_RULES.overshootRate;
}

const round1 = (value: number) => Math.round(value * 10) / 10;
const isNonNegative = (value: number) => Number.isFinite(value) && value >= 0;

function assertConditions(conditions: QuarterConditions): void {
  if (!isNonNegative(conditions.baseRevenue)) throw new RangeError("baseRevenue must be a finite number ≥ 0");
  if (!(Number.isFinite(conditions.costIndex) && conditions.costIndex > 0)) throw new RangeError("costIndex must be a finite number > 0");
  for (const department of DEPARTMENTS) {
    const heads = conditions.headcount[department.id];
    if (!(Number.isInteger(heads) && heads >= 0)) throw new RangeError(`headcount for ${department.id} must be a whole number ≥ 0`);
    if (conditions.targetHeadcount && !isNonNegative(conditions.targetHeadcount[department.id])) {
      throw new RangeError(`target headcount for ${department.id} must be a finite number ≥ 0`);
    }
  }
  if (conditions.employees !== undefined && !(Number.isInteger(conditions.employees) && conditions.employees >= 0)) {
    throw new RangeError("employees must be a whole number ≥ 0");
  }
  for (const modifier of conditions.modifiers ?? []) {
    for (const value of [modifier.revenueMultiplier ?? 1, modifier.costMultiplier ?? 1]) {
      if (!isNonNegative(value)) throw new RangeError(`modifier ${modifier.id} must use finite multipliers ≥ 0`);
    }
  }
}

/**
 * One quarter's financials.
 * @param measuredMetricIds metrics that at least one configured game feeds
 */
export function computeQuarter(
  conditions: QuarterConditions,
  contributions: PeriodContributions,
  measuredMetricIds: ReadonlySet<string>,
): QuarterResult {
  assertConditions(conditions);
  const { baseRevenue, costIndex, headcount } = conditions;
  const modifiers = [...(conditions.modifiers ?? [])];

  const employeeCount = conditions.employees ?? DEPARTMENTS.reduce((sum, d) => sum + headcount[d.id], 0);
  const targetHeads = conditions.targetHeadcount ?? headcount;
  const baseCosts = (DEPARTMENTS.reduce((sum, d) => sum + headcount[d.id] * d.costPerHead, 0) + ECONOMY_RULES.fixedOverhead) * costIndex;

  let revenueLift = 0;
  let costSaving = 0;
  const departmentLifts = new Map<DepartmentId, { revenue: number; cost: number }>();
  const metricResults = new Map<string, MetricResult>();

  for (const metric of METRICS) {
    const target = targetHeads[metric.departmentId] * metric.targetPerHead;
    const credited = contributions.byMetric[metric.id] ?? 0;
    const measured = measuredMetricIds.has(metric.id) && target > 0;
    const attainment = measured ? Math.min(credited / target, ECONOMY_RULES.maxAttainment) : null;
    metricResults.set(metric.id, { metricId: metric.id, measured, creditedPoints: credited, target, attainment });

    const effect = attainment === null ? 0 : attainmentEffect(attainment);
    revenueLift += metric.revenueLift * effect;
    costSaving += metric.costSaving * effect;
    const lifts = departmentLifts.get(metric.departmentId) ?? { revenue: 0, cost: 0 };
    lifts.revenue += metric.revenueLift * effect;
    lifts.cost += metric.costSaving * effect;
    departmentLifts.set(metric.departmentId, lifts);
  }

  const revenueMultiplier = modifiers.reduce((m, d) => m * (d.revenueMultiplier ?? 1), 1);
  const costMultiplier = modifiers.reduce((m, d) => m * (d.costMultiplier ?? 1), 1);
  const revenue = Math.round(baseRevenue * (1 + revenueLift) * revenueMultiplier);
  const operatingExpenses = Math.round(baseCosts * Math.max(0, 1 - costSaving) * costMultiplier);
  const operatingProfit = revenue - operatingExpenses;
  const tax = Math.round(Math.max(0, operatingProfit) * ECONOMY_RULES.taxRate);

  const totalCredited = contributions.totalCredited;
  const departments: DepartmentResult[] = DEPARTMENTS.map((department) => {
    const metrics = METRICS.filter((m) => m.departmentId === department.id).map((m) => metricResults.get(m.id)!);
    const measured = metrics.filter((m) => m.measured);
    const attainment = measured.length > 0 ? measured.reduce((sum, m) => sum + m.attainment!, 0) / measured.length : null;
    const creditedPoints = metrics.reduce((sum, m) => sum + m.creditedPoints, 0);
    const lifts = departmentLifts.get(department.id) ?? { revenue: 0, cost: 0 };
    return {
      departmentId: department.id,
      headcount: headcount[department.id],
      measured: attainment !== null,
      attainment,
      status: departmentStatus(attainment),
      creditedPoints,
      target: metrics.reduce((sum, m) => sum + m.target, 0),
      contributionShare: totalCredited > 0 ? creditedPoints / totalCredited : 0,
      revenueImpact: Math.round(baseRevenue * lifts.revenue),
      costSavings: Math.round(baseCosts * lifts.cost),
      metrics,
    };
  });

  const measuredDepartments = departments.filter((d) => d.attainment !== null);
  const measuredHeads = measuredDepartments.reduce((sum, d) => sum + d.headcount, 0);
  const executionScore =
    measuredHeads > 0 ? measuredDepartments.reduce((sum, d) => sum + Math.min(1, d.attainment!) * d.headcount, 0) / measuredHeads : 0;
  const participationRate = employeeCount > 0 ? Math.min(1, contributions.activeContributors / employeeCount) : 0;
  const balanceScore = balanceOf(measuredDepartments.map((d) => d.attainment!));

  const weights = ECONOMY_RULES.efficiencyWeights;
  const components = [
    [weights.execution, executionScore],
    [weights.participation, participationRate],
    ...(balanceScore === null ? [] : [[weights.balance, balanceScore]]),
  ];
  const weightTotal = components.reduce((sum, [w]) => sum + w, 0);
  const operatingEfficiency = round1((100 * components.reduce((sum, [w, v]) => sum + w * v, 0)) / weightTotal);

  return {
    periodId: conditions.periodId,
    modelVersion: ECONOMY_MODEL_VERSION,
    employeeCount,
    baseRevenue: Math.round(baseRevenue),
    revenue,
    operatingExpenses,
    operatingProfit,
    profitMargin: revenue > 0 ? operatingProfit / revenue : null,
    tax,
    netProfit: operatingProfit - tax,
    operatingEfficiency,
    participationRate,
    executionScore,
    balanceScore,
    activeContributors: contributions.activeContributors,
    acceptedEvents: contributions.accepted.length,
    rejectedEvents: contributions.rejected.length,
    totalCreditedPoints: totalCredited,
    departments,
    modifiers,
  };
}

/** 1 − coefficient of variation, clamped to [0, 1]. Null with fewer than two values. */
export function balanceOf(attainments: readonly number[]): number | null {
  if (attainments.length < 2) return null;
  const mean = attainments.reduce((sum, a) => sum + a, 0) / attainments.length;
  if (mean <= 0) return 0;
  const variance = attainments.reduce((sum, a) => sum + (a - mean) ** 2, 0) / attainments.length;
  return Math.min(1, Math.max(0, 1 - Math.sqrt(variance) / mean));
}

export function departmentName(id: DepartmentId): string {
  return getDepartment(id).name;
}
