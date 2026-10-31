/**
 * Runs the company through consecutive quarters:
 *
 *   contribution events → per-period credited points → department metrics
 *   → quarter financials → milestones → earnings reports
 *
 * Pure and deterministic: the same input always produces the same output,
 * whatever order the events arrive in.
 */
import { METRICS } from "./departments";
import { EMPTY_LEDGER_STATE, aggregatePeriod, type ContributionLedgerState, type PeriodContributions } from "./contribution";
import { computeQuarter, type QuarterConditions, type QuarterResult } from "./economy";
import type { GameContributionRule } from "./games";
import { evaluateMilestones, type MilestoneStatus } from "./milestones";
import { nextPeriod, periodOf, periodStart } from "./periods";
import { buildEarningsReport, finalizeEarningsReport, type EarningsReport } from "./report";
import type { ContributionEvent, PeriodId, Provenance } from "./types";

export interface SimulationInput {
  companyId: string;
  companyName: string;
  provenance: Provenance;
  rules: readonly GameContributionRule[];
  /** Consecutive quarters, oldest first. */
  quarters: readonly QuarterConditions[];
  events: readonly ContributionEvent[];
}

export interface SimulationResult {
  quarters: QuarterResult[];
  contributions: PeriodContributions[];
  /** One per quarter. All but the latest are finalized; the latest is a draft. */
  reports: EarningsReport[];
  milestones: MilestoneStatus[];
  /** Events dated outside every simulated quarter. */
  unassignedEvents: number;
}

export function measuredMetrics(rules: readonly GameContributionRule[]): Set<string> {
  return new Set(rules.flatMap((rule) => Object.keys(rule.metricWeights)));
}

export function simulateCompany(input: SimulationInput): SimulationResult {
  const periods = input.quarters.map((q) => q.periodId);
  periods.forEach((period, i) => {
    if (i > 0 && period !== nextPeriod(periods[i - 1])) throw new RangeError("Quarters must be consecutive");
  });

  // Group by quarter. Undatable events go to the first quarter so they are reported as invalid.
  const byPeriod = new Map<PeriodId, ContributionEvent[]>(periods.map((p) => [p, []]));
  let unassignedEvents = 0;
  for (const event of input.events) {
    const period = periodOf(typeof event.completedAt === "string" ? event.completedAt : "") ?? periods[0];
    const bucket = period ? byPeriod.get(period) : undefined;
    if (bucket) bucket.push(event);
    else unassignedEvents++;
  }

  const metricIds = METRICS.map((m) => m.id);
  const measured = measuredMetrics(input.rules);
  let ledger: ContributionLedgerState = EMPTY_LEDGER_STATE;
  const quarters: QuarterResult[] = [];
  const contributions: PeriodContributions[] = [];
  const reports: EarningsReport[] = [];

  for (const conditions of input.quarters) {
    const aggregated = aggregatePeriod(byPeriod.get(conditions.periodId) ?? [], {
      periodId: conditions.periodId,
      provenance: input.provenance,
      rules: input.rules,
      metricIds,
      ledger,
    });
    ledger = aggregated.ledger;
    const quarter = computeQuarter(conditions, aggregated.contributions, measured);
    const previous = quarters.at(-1) ?? null;
    quarters.push(quarter);
    contributions.push(aggregated.contributions);

    const report = buildEarningsReport({
      companyId: input.companyId,
      companyName: input.companyName,
      quarter,
      previous,
      milestones: evaluateMilestones(quarters),
      source: input.provenance === "demo" ? "demo" : "server",
    });
    reports.push(report);
  }

  // Closed quarters are finalized at the start of the next one.
  const finalized = reports.map((report, i) =>
    i < reports.length - 1 ? finalizeEarningsReport(report, new Date(periodStart(nextPeriod(report.periodId))).toISOString()) : report,
  );

  return { quarters, contributions, reports: finalized, milestones: evaluateMilestones(quarters), unassignedEvents };
}
