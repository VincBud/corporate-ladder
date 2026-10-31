/**
 * Live company: turns one quarter of verified contribution events into a
 * public CompanySnapshot, using the same engine as the preview. Pure and
 * deterministic; the server supplies the rows (server/company/service.ts).
 *
 * Company model (v0.1)
 *   Baseline      A seeded, fictional company: base revenue 16.0M CB per
 *                 quarter and the cost structure of STAFFING_PLAN roles
 *                 (16.71M CB). Roles are not employees and are never counted
 *                 as such. No market growth or inflation: without verified
 *                 activity the company stays at its baseline.
 *   Employees     Registered player profiles, excluding test accounts.
 *   Active        Employees with at least one verified round this quarter.
 *   Contributing  Active employees whose rounds earned points (> 0).
 *   Targets       Workload grows with the workforce. Each department's
 *                 target headcount = registered employees × its share of
 *                 STAFFING_PLAN, independent of membership (most players
 *                 haven't chosen a department, and attribution follows the
 *                 game, not the player). Zero employees → no targets → no
 *                 measured departments.
 *   Participation Contributing / registered employees.
 *
 * Contribution effects are incremental: revenue lift and cost savings on top
 * of the baseline (see economy.ts). With few employees, targets are small,
 * so a single strong round is visible; with many, the same round matters less.
 */
import { BRAND } from "@/config/brand";
import { CANONICAL_DEPARTMENTS } from "@/config/departments";
import { aggregatePeriod } from "./contribution";
import { DEPARTMENTS, METRICS, STAFFING_PLAN, getDepartment, staffingShare } from "./departments";
import { ECONOMY_MODEL_VERSION, computeQuarter, type QuarterConditions, type QuarterResult } from "./economy";
import { LIVE_GAME_RULES, type GameContributionRule } from "./games";
import { evaluateMilestones } from "./milestones";
import { nextPeriod, periodLabel, periodStart } from "./periods";
import { measuredMetrics } from "./simulate";
import { COMPANY_SNAPSHOT_SCHEMA_VERSION, MIN_GROUP_SIZE, contributionEventFromRow, type CompanySnapshot, type ContributionEventRow, type GroupCount } from "./source";
import { DEPARTMENT_IDS, type DepartmentId, type PeriodId } from "./types";

export const LIVE_COMPANY = {
  companyId: "consolidated-synergy-holdings",
  baseRevenue: 16_000_000,
  costIndex: 1,
} as const;

export interface AllocationRow {
  game_id: string;
  formula_version: number;
  metric_id: string;
  department_id: string;
  weight_bp: number;
}

/** One quarter of data, as read by the server. */
export interface LiveQuarterInput {
  periodId: PeriodId;
  /** Database time (ISO). */
  generatedAt: string;
  registeredEmployees: number;
  /** Registered employees per department id (null = unassigned). */
  membership: { departmentId: string | null; members: number }[];
  /** Verified events of this quarter, each with its player's current department. */
  events: (ContributionEventRow & { department_id: string | null })[];
  /** Every published formula allocation. */
  allocations: AllocationRow[];
  lastContributionAt: string | null;
}

export class FormulaMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormulaMismatchError";
  }
}

/**
 * The database's published allocation for every formula this server applies
 * must match the TypeScript rule exactly (metric, department and weight).
 * Versions only the database knows are fine: their events are rejected.
 */
export function verifyAllocations(allocations: readonly AllocationRow[], rules: readonly GameContributionRule[] = LIVE_GAME_RULES): void {
  for (const rule of rules) {
    const rows = allocations.filter((a) => a.game_id === rule.gameId && a.formula_version === rule.formulaVersion);
    const expected = Object.entries(rule.metricWeights)
      .map(([metric, weight]) => `${metric}:${METRICS.find((m) => m.id === metric)?.departmentId}:${Math.round(weight * 10_000)}`)
      .sort();
    const actual = rows.map((r) => `${r.metric_id}:${r.department_id}:${r.weight_bp}`).sort();
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      throw new FormulaMismatchError(`${rule.gameId} formula v${rule.formulaVersion}: database allocation ${actual.join(",") || "missing"} ≠ ${expected.join(",")}`);
    }
  }
}

/**
 * Withholds small groups: cells with 1 to minSize − 1 people become null.
 * If exactly one cell is withheld, the smallest other non-zero cell is
 * withheld too, so it can't be derived from the total. The whole breakdown
 * is withheld when its total is below minSize.
 */
export function suppressSmallGroups(counts: readonly number[], minSize = MIN_GROUP_SIZE): (number | null)[] | null {
  const total = counts.reduce((sum, c) => sum + c, 0);
  if (total < minSize) return null;
  const result: (number | null)[] = counts.map((c) => (c > 0 && c < minSize ? null : c));
  if (result.filter((c) => c === null).length === 1) {
    let smallest = -1;
    result.forEach((c, i) => {
      if (c !== null && c > 0 && (smallest === -1 || c < (result[smallest] as number))) smallest = i;
    });
    if (smallest !== -1) result[smallest] = null;
  }
  return result;
}

const GROUPS: { id: string; name: string }[] = [
  ...CANONICAL_DEPARTMENTS.map(({ id, name }) => ({ id, name })),
  { id: "unassigned", name: "No department yet" },
];

function breakdown(countFor: (groupId: string) => number): GroupCount[] | null {
  const counts = suppressSmallGroups(GROUPS.map((g) => countFor(g.id)));
  return counts && GROUPS.map((g, i) => ({ id: g.id, name: g.name, count: counts[i] }));
}

const round2 = (value: number) => Math.round(value * 100) / 100;
const round3 = (value: number) => Math.round(value * 1000) / 1000;

export function liveQuarterConditions(periodId: PeriodId, registeredEmployees: number): QuarterConditions {
  return {
    periodId,
    headcount: STAFFING_PLAN,
    targetHeadcount: Object.fromEntries(DEPARTMENT_IDS.map((id) => [id, registeredEmployees * staffingShare(id)])) as Record<DepartmentId, number>,
    employees: registeredEmployees,
    baseRevenue: LIVE_COMPANY.baseRevenue,
    costIndex: LIVE_COMPANY.costIndex,
  };
}

/** Builds the public snapshot for one quarter. Throws FormulaMismatchError on inconsistent formulas. */
export function buildLiveSnapshot(input: LiveQuarterInput, rules: readonly GameContributionRule[] = LIVE_GAME_RULES): { snapshot: CompanySnapshot; quarter: QuarterResult } {
  if (!(Number.isInteger(input.registeredEmployees) && input.registeredEmployees >= 0)) throw new RangeError("registeredEmployees must be a whole number ≥ 0");
  verifyAllocations(input.allocations, rules);

  const { contributions } = aggregatePeriod(input.events.map(contributionEventFromRow), {
    periodId: input.periodId,
    provenance: "server-verified",
    rules,
    metricIds: METRICS.map((m) => m.id),
  });

  // Each employee counts once, however many rounds they played.
  const departmentOf = new Map(input.events.map((e) => [e.user_id, e.department_id]));
  const activePlayers = [...new Set(contributions.accepted.map((c) => c.playerId))];
  if (activePlayers.length > input.registeredEmployees) throw new RangeError("More active employees than registered employees");
  const membersIn = (id: string) =>
    input.membership.filter((m) => (m.departmentId ?? "unassigned") === id).reduce((sum, m) => sum + m.members, 0);
  const activeIn = (id: string) => activePlayers.filter((p) => (departmentOf.get(p) ?? "unassigned") === id).length;

  const conditions = liveQuarterConditions(input.periodId, input.registeredEmployees);
  const quarter = computeQuarter(conditions, contributions, measuredMetrics(rules));
  const baseline = computeQuarter(conditions, { ...contributions, accepted: [], byMetric: {}, totalRaw: 0, totalCredited: 0, activeContributors: 0 }, new Set());

  const snapshot: CompanySnapshot = {
    schemaVersion: COMPANY_SNAPSHOT_SCHEMA_VERSION,
    companyId: LIVE_COMPANY.companyId,
    companyName: BRAND.company,
    currency: "CB",
    fictional: true,
    generatedAt: new Date(input.generatedAt).toISOString(),
    modelVersion: ECONOMY_MODEL_VERSION,
    formulaVersions: rules.map((r) => ({ gameId: r.gameId, formulaVersion: r.formulaVersion })),
    period: {
      id: input.periodId,
      label: periodLabel(input.periodId),
      startsAt: new Date(periodStart(input.periodId)).toISOString(),
      endsAt: new Date(periodStart(nextPeriod(input.periodId))).toISOString(),
      status: "open",
    },
    lastContributionAt: input.lastContributionAt ? new Date(input.lastContributionAt).toISOString() : null,
    dataStatus: input.registeredEmployees === 0 ? "noEmployees" : activePlayers.length === 0 ? "noActivity" : "active",
    employees: {
      registered: input.registeredEmployees,
      active: activePlayers.length,
      contributing: contributions.activeContributors,
      minGroupSize: MIN_GROUP_SIZE,
      membership: breakdown(membersIn),
      activeByDepartment: breakdown(activeIn),
    },
    baseline: { revenue: baseline.revenue, operatingExpenses: baseline.operatingExpenses, operatingProfit: baseline.operatingProfit },
    financials: {
      revenue: quarter.revenue,
      operatingExpenses: quarter.operatingExpenses,
      operatingProfit: quarter.operatingProfit,
      profitMargin: quarter.profitMargin === null ? null : round3(quarter.profitMargin),
      tax: quarter.tax,
      netProfit: quarter.netProfit,
      operatingEfficiency: quarter.operatingEfficiency,
      participationRate: round3(quarter.participationRate),
      executionScore: round3(quarter.executionScore),
      balanceScore: quarter.balanceScore === null ? null : round3(quarter.balanceScore),
    },
    impact: {
      revenue: quarter.revenue - baseline.revenue,
      costSavings: baseline.operatingExpenses - quarter.operatingExpenses,
      operatingProfit: quarter.operatingProfit - baseline.operatingProfit,
    },
    departments: DEPARTMENTS.map((d) => {
      const result = quarter.departments.find((r) => r.departmentId === d.id)!;
      return {
        id: d.id,
        name: getDepartment(d.id).name,
        measured: result.measured,
        attainment: result.attainment === null ? null : round2(result.attainment),
        status: result.status,
        contributionShare: round2(result.contributionShare),
        revenueImpact: result.revenueImpact,
        costSavings: result.costSavings,
      };
    }),
    milestones: evaluateMilestones([quarter]),
    reports: [],
  };
  return { snapshot, quarter };
}
