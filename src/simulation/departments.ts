/**
 * Department and operational metric definitions.
 *
 * Adding a department: add its id to DEPARTMENT_IDS, then an entry here and
 * at least one metric. The engine reads everything from these tables.
 *
 * Ids are the canonical department ids (config/departments.ts), the same as
 * the `departments` table in Supabase. Department membership (a player's
 * profile) is separate: it never decides which metrics a game feeds.
 */
import type { DepartmentId, GameplayCategory } from "./types";

export interface DepartmentDefinition {
  id: DepartmentId;
  name: string;
  description: string;
  categories: readonly GameplayCategory[];
  /** Operating cost per employee per quarter (CB). */
  costPerHead: number;
  /** Future career track. Not selectable yet. */
  careerPath: {
    status: "planned";
    entryTitle: string;
    seniorTitle: string;
    executiveTitle: string;
  };
  /** How the dashboard shows the department. */
  representation: {
    /** Tailwind background class for bars and dots. */
    color: string;
    shortName: string;
  };
}

export interface MetricDefinition {
  id: string;
  departmentId: DepartmentId;
  label: string;
  description: string;
  /**
   * Contribution points per department employee per quarter that count as
   * "on target". Workload scales with department size, so bigger departments
   * need more output for the same attainment.
   */
  targetPerHead: number;
  /** Revenue increase at 100% attainment, as a fraction of base revenue. */
  revenueLift: number;
  /** Operating cost reduction at 100% attainment, as a fraction of base costs. */
  costSaving: number;
}

export const DEPARTMENTS: readonly DepartmentDefinition[] = [
  {
    id: "finance",
    name: "Finance",
    description: "Closes the books, forecasts the future and approves your expense report eventually.",
    categories: ["accounting", "forecasting", "expense-control"],
    costPerHead: 31_000,
    careerPath: { status: "planned", entryTitle: "Junior Accountant", seniorTitle: "Finance Manager", executiveTitle: "Chief Financial Officer" },
    representation: { color: "bg-emerald-400", shortName: "FIN" },
  },
  {
    id: "controlling",
    name: "Controlling",
    description: "Reconciles ledgers, explains variances and asks why the numbers moved.",
    categories: ["accounting", "reconciliation", "forecasting"],
    costPerHead: 32_000,
    careerPath: { status: "planned", entryTitle: "Controlling Analyst", seniorTitle: "Head of Controlling", executiveTitle: "Chief Controlling Officer" },
    representation: { color: "bg-teal-400", shortName: "CTL" },
  },
  {
    id: "people",
    name: "Human Resources",
    description: "Hires, onboards and schedules mandatory fun.",
    categories: ["people-operations", "communication"],
    costPerHead: 27_000,
    careerPath: { status: "planned", entryTitle: "HR Coordinator", seniorTitle: "People Partner", executiveTitle: "Chief People Officer" },
    representation: { color: "bg-pink-400", shortName: "HR" },
  },
  {
    id: "sales",
    name: "Sales",
    description: "Turns pipelines into revenue and lunches into pipelines.",
    categories: ["negotiation", "communication", "forecasting"],
    costPerHead: 34_000,
    careerPath: { status: "planned", entryTitle: "Sales Development Rep", seniorTitle: "Account Director", executiveTitle: "Chief Revenue Officer" },
    representation: { color: "bg-amber-400", shortName: "SLS" },
  },
  {
    id: "operations",
    name: "Operations & Supply Chain",
    description: "Moves things from where they are to where they should have been yesterday.",
    categories: ["logistics", "expense-control"],
    costPerHead: 29_000,
    careerPath: { status: "planned", entryTitle: "Operations Associate", seniorTitle: "Supply Chain Manager", executiveTitle: "Chief Operating Officer" },
    representation: { color: "bg-orange-400", shortName: "OPS" },
  },
  {
    id: "it",
    name: "IT & Engineering",
    description: "Keeps the systems up and asks whether you tried turning it off and on again.",
    categories: ["troubleshooting", "logistics"],
    costPerHead: 38_000,
    careerPath: { status: "planned", entryTitle: "Support Engineer", seniorTitle: "Engineering Manager", executiveTitle: "Chief Technology Officer" },
    representation: { color: "bg-sky-400", shortName: "IT" },
  },
  {
    id: "marketing",
    name: "Marketing",
    description: "Builds the brand, one rebrand at a time.",
    categories: ["campaign-planning", "communication"],
    costPerHead: 30_000,
    careerPath: { status: "planned", entryTitle: "Marketing Coordinator", seniorTitle: "Brand Director", executiveTitle: "Chief Marketing Officer" },
    representation: { color: "bg-violet-400", shortName: "MKT" },
  },
];

export const METRICS: readonly MetricDefinition[] = [
  {
    id: "close-quality",
    departmentId: "finance",
    label: "Close quality",
    description: "Month-end close completed without restatements.",
    targetPerHead: 120,
    revenueLift: 0.01,
    costSaving: 0.012,
  },
  {
    id: "ledger-integrity",
    departmentId: "controlling",
    label: "Ledger integrity",
    description: "Discrepancies found and corrected before anyone important notices.",
    targetPerHead: 120,
    revenueLift: 0.01,
    costSaving: 0.015,
  },
  {
    id: "people-operations",
    departmentId: "people",
    label: "People operations",
    description: "Requests resolved, onboarding completed, morale technically measurable.",
    targetPerHead: 120,
    revenueLift: 0.01,
    costSaving: 0.01,
  },
  {
    id: "pipeline-health",
    departmentId: "sales",
    label: "Pipeline health",
    description: "Qualified opportunities moved forward, not just renamed.",
    targetPerHead: 120,
    revenueLift: 0.06,
    costSaving: 0,
  },
  {
    id: "fulfilment-reliability",
    departmentId: "operations",
    label: "Fulfilment reliability",
    description: "Orders shipped complete and on time.",
    targetPerHead: 120,
    revenueLift: 0.03,
    costSaving: 0.012,
  },
  {
    id: "service-reliability",
    departmentId: "it",
    label: "Service reliability",
    description: "Tickets resolved and systems kept running.",
    targetPerHead: 120,
    revenueLift: 0.02,
    costSaving: 0.011,
  },
  {
    id: "campaign-effectiveness",
    departmentId: "marketing",
    label: "Campaign effectiveness",
    description: "Campaigns that reached someone other than the marketing team.",
    targetPerHead: 120,
    revenueLift: 0.04,
    costSaving: 0,
  },
];

const DEPARTMENT_BY_ID = new Map(DEPARTMENTS.map((d) => [d.id, d]));
const METRIC_BY_ID = new Map(METRICS.map((m) => [m.id, m]));

export function getDepartment(id: DepartmentId): DepartmentDefinition {
  const department = DEPARTMENT_BY_ID.get(id);
  if (!department) throw new Error(`Unknown department: ${id}`);
  return department;
}

export function getMetric(id: string): MetricDefinition | undefined {
  return METRIC_BY_ID.get(id);
}

export function metricsOf(departmentId: DepartmentId): MetricDefinition[] {
  return METRICS.filter((m) => m.departmentId === departmentId);
}

/**
 * The fictional company's role plan: roles per operating department. It sets
 * the seeded cost structure and each department's share of the workload.
 * These are roles, not employees; nobody is counted as an employee because
 * of this table.
 */
export const STAFFING_PLAN: Readonly<Record<DepartmentId, number>> = {
  finance: 52,
  controlling: 38,
  people: 30,
  sales: 96,
  operations: 110,
  it: 72,
  marketing: 46,
};

/** Each department's share of the role plan (sums to 1). */
export function staffingShare(id: DepartmentId): number {
  const total = Object.values(STAFFING_PLAN).reduce((sum, n) => sum + n, 0);
  return STAFFING_PLAN[id] / total;
}
