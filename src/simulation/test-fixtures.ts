/** Builders for simulation tests. */
import { METRICS } from "./departments";
import { aggregatePeriod, type PeriodContributions } from "./contribution";
import type { QuarterConditions } from "./economy";
import { LIVE_GAME_RULES, PREVIEW_GAME_RULES } from "./games";
import { DEPARTMENT_IDS, type ContributionEvent, type DepartmentId, type PeriodId } from "./types";

export const METRIC_IDS = METRICS.map((m) => m.id);
export const ALL_METRICS = new Set(METRIC_IDS);

let nextId = 0;

/** A perfect, unassisted Reconciliation Rush round in 2026-Q3 (worth 100 points). */
export function rushEvent(overrides: Partial<ContributionEvent> = {}): ContributionEvent {
  const eventId = overrides.eventId ?? `evt-${++nextId}`;
  return {
    eventId,
    playerId: "player-1",
    gameId: "reconciliation-rush",
    scoringVersion: 1,
    difficulty: "associate",
    seed: `seed-${eventId}`,
    completedAt: "2026-08-01T12:00:00.000Z",
    score: 1000,
    maxScore: 1000,
    objectivesCompleted: 5,
    objectivesTotal: 5,
    mistakes: 0,
    completion: "submitted",
    assisted: false,
    provenance: "server-verified",
    ...overrides,
  };
}

export function liveAggregate(events: ContributionEvent[], periodId: PeriodId = "2026-Q3") {
  return aggregatePeriod(events, { periodId, provenance: "server-verified", rules: LIVE_GAME_RULES, metricIds: METRIC_IDS });
}

export function demoAggregate(events: ContributionEvent[], periodId: PeriodId = "2026-Q3") {
  return aggregatePeriod(events, { periodId, provenance: "demo", rules: PREVIEW_GAME_RULES, metricIds: METRIC_IDS });
}

export function uniformHeadcount(heads: number): Record<DepartmentId, number> {
  return Object.fromEntries(DEPARTMENT_IDS.map((id) => [id, heads])) as Record<DepartmentId, number>;
}

export function conditions(overrides: Partial<QuarterConditions> = {}): QuarterConditions {
  return { periodId: "2026-Q3", headcount: uniformHeadcount(10), baseRevenue: 10_000_000, costIndex: 1, ...overrides };
}

/** Contributions with the given credited points per metric and active players. */
export function contributionsWith(byMetric: Record<string, number>, activeContributors = 0, periodId: PeriodId = "2026-Q3"): PeriodContributions {
  const full = Object.fromEntries(METRIC_IDS.map((id) => [id, byMetric[id] ?? 0]));
  const total = Object.values(full).reduce((sum, v) => sum + v, 0);
  return { periodId, accepted: [], rejected: [], byMetric: full, totalRaw: total, totalCredited: total, activeContributors };
}
