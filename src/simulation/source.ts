/**
 * Contract for real, server-authoritative company data.
 *
 *   Verified game result      game_results row, scored by the server (Backend Foundation)
 *   → Contribution event       contribution_events row, created by finalize_game_session in the
 *                              same transaction (Verified Company Contributions)
 *   → Normalized contribution  contributionEventFromRow + aggregatePeriod (server only, live.ts)
 *   → Department metrics       computeQuarter
 *   → Company state            CompanySnapshot, served read-only by GET /api/company (Live Company)
 *   → Quarterly report         buildEarningsReport, finalized once per closed quarter (not yet)
 *
 * Rules:
 * - The browser never writes company figures and never submits contributions.
 *   Contributions come only from results the server verified itself.
 * - Client-reported XP and scores are never inputs. The event has no XP field.
 * - A snapshot is aggregate-only: no player ids, rounds, seeds or events, and
 *   membership breakdowns suppress groups smaller than MIN_GROUP_SIZE.
 * - Demo data never enters a snapshot: snapshots contain server-sourced reports only.
 */
import type { GameResultRecord } from "@/types/progression";
import type { DepartmentStatus } from "./economy";
import type { MilestoneStatus } from "./milestones";
import { isPeriodId } from "./periods";
import type { FinalizedEarningsReport } from "./report";
import type { ContributionEvent, DepartmentId, PeriodId } from "./types";

export const COMPANY_SNAPSHOT_SCHEMA_VERSION = 1;

/** Membership breakdown cells with 1 to MIN_GROUP_SIZE − 1 people are withheld. */
export const MIN_GROUP_SIZE = 5;

export interface PublicDepartmentPerformance {
  id: DepartmentId;
  name: string;
  measured: boolean;
  /** 0–1.5, rounded to two decimals; null when no live game feeds the department. */
  attainment: number | null;
  status: DepartmentStatus;
  /** Share of this quarter's credited contribution, rounded to two decimals. */
  contributionShare: number;
  /** Fictional CB added by this department's metrics. */
  revenueImpact: number;
  costSavings: number;
}

/** One cell of a membership breakdown. Null counts are withheld for privacy. */
export interface GroupCount {
  /** Canonical department id, or "unassigned". */
  id: string;
  name: string;
  count: number | null;
}

/** What GET /api/company publishes. All money is fictional CorpBucks. */
export interface CompanySnapshot {
  schemaVersion: typeof COMPANY_SNAPSHOT_SCHEMA_VERSION;
  companyId: string;
  companyName: string;
  currency: "CB";
  fictional: true;
  /** Database time when the snapshot was computed (ISO). */
  generatedAt: string;
  modelVersion: number;
  /** Contribution formula versions this server can apply. */
  formulaVersions: { gameId: string; formulaVersion: number }[];
  period: { id: PeriodId; label: string; startsAt: string; endsAt: string; status: "open" };
  /** When the latest verified contribution in this quarter was recorded, or null. */
  lastContributionAt: string | null;
  /** noEmployees: nobody registered · noActivity: no verified rounds this quarter · active */
  dataStatus: "noEmployees" | "noActivity" | "active";
  employees: {
    /** Registered player profiles (excluding test accounts). */
    registered: number;
    /** Employees with at least one verified round this quarter. */
    active: number;
    /** Active employees whose rounds earned contribution points. */
    contributing: number;
    minGroupSize: number;
    /** Members per department (incl. unassigned); null when the total is below minGroupSize. */
    membership: GroupCount[] | null;
    /** Active employees by their department membership; null when too few to break down. */
    activeByDepartment: GroupCount[] | null;
  };
  /** The seeded fictional company before any player contribution. */
  baseline: { revenue: number; operatingExpenses: number; operatingProfit: number };
  financials: {
    revenue: number;
    operatingExpenses: number;
    operatingProfit: number;
    profitMargin: number | null;
    tax: number;
    netProfit: number;
    operatingEfficiency: number;
    participationRate: number;
    executionScore: number;
    balanceScore: number | null;
  };
  /** What verified contributions changed compared with the baseline. */
  impact: { revenue: number; costSavings: number; operatingProfit: number };
  departments: PublicDepartmentPerformance[];
  milestones: MilestoneStatus[];
  /** Finalized earnings reports for closed quarters. Empty until quarter closing exists. */
  reports: FinalizedEarningsReport[];
}

export type CompanySnapshotResult =
  | { status: "ok"; snapshot: CompanySnapshot }
  /** The server has no backend configured. */
  | { status: "notConfigured" }
  | { status: "unavailable"; message: string };

/** Read-only source the Company app uses for live data. */
export interface CompanyDataSource {
  loadSnapshot(): Promise<CompanySnapshotResult>;
}

/**
 * A row of public.contribution_events (snake_case, as stored). Events are
 * created only inside the database from verified results; there is no
 * write API.
 */
export interface ContributionEventRow {
  id: string;
  session_id: string;
  user_id: string;
  game_id: string;
  rules_version: number;
  seed: string;
  formula_version: number;
  completed_at: string | Date;
  period_id: string;
  difficulty: string;
  completion: "submitted" | "timedOut";
  assisted: boolean;
  score: number;
  max_score: number;
  objectives_completed: number;
  objectives_total: number;
  mistakes: number;
  source: "finalize" | "recovery" | "backfill";
  created_at: string | Date;
}

/**
 * Server only: maps a stored contribution event to the engine's event. The
 * round (session) id is the event id the engine deduplicates on.
 */
export function contributionEventFromRow(row: ContributionEventRow): ContributionEvent & { provenance: "server-verified" } {
  return {
    eventId: row.session_id,
    playerId: row.user_id,
    gameId: row.game_id,
    scoringVersion: row.rules_version,
    difficulty: row.difficulty,
    seed: row.seed,
    completedAt: new Date(row.completed_at).toISOString(),
    score: row.score,
    maxScore: row.max_score,
    objectivesCompleted: row.objectives_completed,
    objectivesTotal: row.objectives_total,
    mistakes: row.mistakes,
    completion: row.completion,
    assisted: row.assisted,
    provenance: "server-verified",
    formulaVersion: row.formula_version,
  };
}

/**
 * Server only: maps a result the server scored itself to a contribution
 * event. Never call this with data that came from a browser.
 * `xpAwarded` is intentionally ignored.
 */
export function contributionEventFromVerifiedResult(record: GameResultRecord, playerId: string): ContributionEvent & { provenance: "server-verified" } {
  return {
    eventId: record.id,
    playerId,
    gameId: record.gameId,
    scoringVersion: record.scoringVersion,
    difficulty: record.difficulty,
    seed: record.seed,
    completedAt: record.completedAt,
    score: record.score,
    maxScore: record.maxScore,
    objectivesCompleted: record.errorsFixed,
    objectivesTotal: record.totalErrors,
    mistakes: record.incorrectCorrections,
    completion: record.completion,
    assisted: record.assistanceUsed,
    provenance: "server-verified",
  };
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;
const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const isTimestamp = (value: unknown): value is string => isText(value) && Number.isFinite(Date.parse(value));

function isServerReport(value: unknown): value is FinalizedEarningsReport {
  return (
    isObject(value) &&
    value.status === "finalized" &&
    value.source === "server" &&
    isText(value.reportId) &&
    isText(value.finalizedAt) &&
    isPeriodId(value.periodId) &&
    isNumber(value.revenue) &&
    isNumber(value.operatingProfit)
  );
}

const isGroups = (value: unknown) =>
  value === null ||
  (Array.isArray(value) && value.every((g) => isObject(g) && isText(g.id) && isText(g.name) && (g.count === null || isCount(g.count))));

const isDepartment = (value: unknown) =>
  isObject(value) &&
  isText(value.id) &&
  isText(value.name) &&
  typeof value.measured === "boolean" &&
  (value.attainment === null || isNumber(value.attainment)) &&
  isText(value.status) &&
  isNumber(value.contributionShare) &&
  isNumber(value.revenueImpact) &&
  isNumber(value.costSavings);

/**
 * Validates a snapshot from the network. Returns null for anything
 * malformed, from another schema version, or containing demo reports.
 */
export function parseCompanySnapshot(value: unknown): CompanySnapshot | null {
  if (!isObject(value)) return null;
  if (value.schemaVersion !== COMPANY_SNAPSHOT_SCHEMA_VERSION || value.fictional !== true || value.currency !== "CB") return null;
  if (!isText(value.companyId) || !isText(value.companyName) || !isTimestamp(value.generatedAt) || !isNumber(value.modelVersion)) return null;
  if (!["noEmployees", "noActivity", "active"].includes(value.dataStatus as string)) return null;
  if (!(value.lastContributionAt === null || isTimestamp(value.lastContributionAt))) return null;

  const { period, employees, baseline, financials, impact } = value;
  if (!isObject(period) || !isPeriodId(period.id) || !isText(period.label) || !isTimestamp(period.startsAt) || !isTimestamp(period.endsAt)) return null;
  if (!isObject(employees) || !isCount(employees.registered) || !isCount(employees.active) || !isCount(employees.contributing)) return null;
  if (employees.active > employees.registered || employees.contributing > employees.active) return null;
  if (!isGroups(employees.membership) || !isGroups(employees.activeByDepartment)) return null;
  if (!isObject(baseline) || !["revenue", "operatingExpenses", "operatingProfit"].every((k) => isNumber(baseline[k]))) return null;
  if (
    !isObject(financials) ||
    !["revenue", "operatingExpenses", "operatingProfit", "tax", "netProfit", "operatingEfficiency", "participationRate", "executionScore"].every((k) =>
      isNumber(financials[k]),
    ) ||
    !(financials.profitMargin === null || isNumber(financials.profitMargin))
  ) {
    return null;
  }
  if (!isObject(impact) || !["revenue", "costSavings", "operatingProfit"].every((k) => isNumber(impact[k]))) return null;
  if (!Array.isArray(value.departments) || !value.departments.every(isDepartment)) return null;
  if (!Array.isArray(value.milestones) || !Array.isArray(value.formulaVersions)) return null;
  if (!Array.isArray(value.reports) || !value.reports.every(isServerReport)) return null;
  return value as unknown as CompanySnapshot;
}
