/**
 * Quarterly earnings reports.
 *
 * A report is built from one quarter's results plus the previous quarter for
 * growth figures. Drafts can be rebuilt at any time; finalizing freezes the
 * report. A future server will store finalized reports and never recompute
 * them (modelVersion records which formulas produced them).
 *
 * The management statement is chosen from fixed templates by performance
 * band, using a hash of the report id, so the same report always gets the
 * same text. No AI or external services.
 */
import { createRng } from "@/games/spreadsheet-wars/reconciliation-rush/rng";
import { formatCompactMoney, formatPercent, formatSignedPercent } from "@/lib/format";
import { getDepartment } from "./departments";
import type { DepartmentStatus, QuarterResult } from "./economy";
import type { MilestoneStatus } from "./milestones";
import { periodLabel } from "./periods";
import type { DepartmentId, PeriodId } from "./types";

export type ReportSource = "demo" | "server";
export type StatementTone = "quiet" | "loss" | "record" | "strong" | "soft" | "steady";

export interface DepartmentContribution {
  departmentId: DepartmentId;
  name: string;
  creditedPoints: number;
  share: number;
  attainment: number | null;
  status: DepartmentStatus;
  revenueImpact: number;
  costSavings: number;
}

export interface EarningsReport {
  reportId: string;
  companyName: string;
  periodId: PeriodId;
  periodLabel: string;
  modelVersion: number;
  /** Demo reports are fictional preview data. */
  source: ReportSource;
  status: "draft" | "finalized";
  finalizedAt: string | null;
  revenue: number;
  operatingExpenses: number;
  operatingProfit: number;
  profitMargin: number | null;
  netProfit: number;
  operatingEfficiency: number;
  employeeCount: number;
  participationRate: number;
  growth: {
    /** Revenue change vs. the previous quarter, as a fraction. Null without a usable previous quarter. */
    revenue: number | null;
    /** Operating profit change in CB. */
    operatingProfit: number | null;
    /** Margin change in percentage points (fraction). */
    margin: number | null;
  };
  /** Most credited first. */
  departments: DepartmentContribution[];
  milestones: { id: string; title: string }[];
  statement: { tone: StatementTone; text: string; signedBy: string };
}

export type FinalizedEarningsReport = Readonly<EarningsReport> & { readonly status: "finalized"; readonly finalizedAt: string };

const STATEMENTS: Record<StatementTone, readonly string[]> = {
  quiet: [
    "No measurable work was recorded this quarter. Management is confident this reflects deep strategic thinking.",
    "The office was quiet this quarter. Leadership has commissioned a survey to understand why nobody completed the previous survey.",
  ],
  loss: [
    "We are pleased to report a learning opportunity of {loss}. A task force will meet to discuss forming a task force.",
    "Costs outpaced revenue by {loss}. Management has responded decisively by renaming the cost centers.",
  ],
  record: [
    "Record performance: revenue grew {growth} to {revenue}. Leadership would like to thank itself, and also everyone else.",
    "An exceptional quarter at a {margin} margin. Bonuses are under review until further review.",
  ],
  strong: [
    "A strong quarter with a {margin} operating margin, led by {department}. Please do not let this go to your heads.",
    "Revenue reached {revenue} at a {margin} margin. The pizza party has been approved in principle.",
  ],
  soft: [
    "Revenue softened {growth} to {revenue}. Management attributes this to macroeconomic headwinds and an unfortunate horoscope.",
    "A slight revenue decline of {growth}. We remain committed to doing more with less, starting with less.",
  ],
  steady: [
    "Revenue of {revenue} at a {margin} margin. Steady, predictable and exactly as forecast, after the forecast was updated.",
    "A solid quarter, led by {department}. We will continue to leverage synergies going forward.",
  ],
};

export function statementTone(quarter: QuarterResult, revenueGrowth: number | null): StatementTone {
  if (quarter.totalCreditedPoints === 0) return "quiet";
  if (quarter.operatingProfit < 0) return "loss";
  const margin = quarter.profitMargin ?? 0;
  if (revenueGrowth !== null && revenueGrowth >= 0.06 && margin >= 0.12) return "record";
  if (revenueGrowth !== null && revenueGrowth < 0) return "soft";
  if (margin >= 0.12) return "strong";
  return "steady";
}

export interface BuildReportInput {
  companyName: string;
  quarter: QuarterResult;
  previous: QuarterResult | null;
  /** Milestone status after this quarter; only those reached in it are listed. */
  milestones: readonly MilestoneStatus[];
  source: ReportSource;
  /** Distinguishes reports of different companies or preview scenarios. */
  companyId: string;
}

export function buildEarningsReport({ companyName, quarter, previous, milestones, source, companyId }: BuildReportInput): EarningsReport {
  const revenueGrowth = previous && previous.revenue > 0 ? (quarter.revenue - previous.revenue) / previous.revenue : null;
  const marginChange =
    previous && previous.profitMargin !== null && quarter.profitMargin !== null ? quarter.profitMargin - previous.profitMargin : null;

  const departments = quarter.departments
    .map((d) => ({
      departmentId: d.departmentId,
      name: getDepartment(d.departmentId).name,
      creditedPoints: d.creditedPoints,
      share: d.contributionShare,
      attainment: d.attainment,
      status: d.status,
      revenueImpact: d.revenueImpact,
      costSavings: d.costSavings,
    }))
    .sort((a, b) => b.creditedPoints - a.creditedPoints || a.name.localeCompare(b.name));

  const reportId = `${companyId}:${quarter.periodId}:m${quarter.modelVersion}`;
  const tone = statementTone(quarter, revenueGrowth);
  const template = createRng(reportId).pick(STATEMENTS[tone]);
  const values: Record<string, string> = {
    revenue: formatCompactMoney(quarter.revenue),
    margin: quarter.profitMargin === null ? "n/a" : formatPercent(quarter.profitMargin),
    growth: revenueGrowth === null ? "n/a" : formatSignedPercent(revenueGrowth),
    loss: formatCompactMoney(Math.abs(Math.min(0, quarter.operatingProfit))),
    department: departments[0]?.creditedPoints ? departments[0].name : "everyone",
  };

  return {
    reportId,
    companyName,
    periodId: quarter.periodId,
    periodLabel: periodLabel(quarter.periodId),
    modelVersion: quarter.modelVersion,
    source,
    status: "draft",
    finalizedAt: null,
    revenue: quarter.revenue,
    operatingExpenses: quarter.operatingExpenses,
    operatingProfit: quarter.operatingProfit,
    profitMargin: quarter.profitMargin,
    netProfit: quarter.netProfit,
    operatingEfficiency: quarter.operatingEfficiency,
    employeeCount: quarter.employeeCount,
    participationRate: quarter.participationRate,
    growth: {
      revenue: revenueGrowth,
      operatingProfit: previous ? quarter.operatingProfit - previous.operatingProfit : null,
      margin: marginChange,
    },
    departments,
    milestones: milestones.filter((m) => m.reachedIn === quarter.periodId).map(({ id, title }) => ({ id, title })),
    statement: {
      tone,
      text: template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? ""),
      signedBy: "Office of the CEO",
    },
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** Returns a frozen, finalized copy. Finalized reports can't be finalized again. */
export function finalizeEarningsReport(report: EarningsReport, finalizedAt: string): FinalizedEarningsReport {
  if (report.status === "finalized") throw new Error(`Report ${report.reportId} is already finalized`);
  if (!Number.isFinite(Date.parse(finalizedAt))) throw new RangeError("finalizedAt must be an ISO timestamp");
  const copy: EarningsReport = structuredClone({ ...report, status: "finalized", finalizedAt });
  return deepFreeze(copy) as FinalizedEarningsReport;
}
