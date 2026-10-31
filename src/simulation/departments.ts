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
import { getCanonicalDepartment } from "@/config/departments";
import type { DepartmentId, GameplayCategory } from "./types";

/** An operating department as the simulation sees it. Name and description come from the canonical registry. */
export interface DepartmentDefinition {
  id: DepartmentId;
  name: string;
  description: string;
  categories: readonly GameplayCategory[];
  /** Operating cost per employee per quarter (CB). */
  costPerHead: number;
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

const DEFINITIONS: readonly Omit<DepartmentDefinition, "name" | "description">[] = [
  {
    id: "finance",
    categories: ["accounting", "forecasting", "expense-control"],
    costPerHead: 31_000,
    representation: { color: "bg-emerald-400", shortName: "FIN" },
  },
  {
    id: "controlling",
    categories: ["accounting", "reconciliation", "forecasting"],
    costPerHead: 32_000,
    representation: { color: "bg-teal-400", shortName: "CTL" },
  },
  {
    id: "people",
    categories: ["people-operations", "communication"],
    costPerHead: 27_000,
    representation: { color: "bg-pink-400", shortName: "HR" },
  },
  {
    id: "sales",
    categories: ["negotiation", "communication", "forecasting"],
    costPerHead: 34_000,
    representation: { color: "bg-amber-400", shortName: "SLS" },
  },
  {
    id: "operations",
    categories: ["logistics", "expense-control"],
    costPerHead: 29_000,
    representation: { color: "bg-orange-400", shortName: "OPS" },
  },
  {
    id: "it",
    categories: ["troubleshooting", "logistics"],
    costPerHead: 38_000,
    representation: { color: "bg-sky-400", shortName: "IT" },
  },
  {
    id: "marketing",
    categories: ["campaign-planning", "communication"],
    costPerHead: 30_000,
    representation: { color: "bg-violet-400", shortName: "MKT" },
  },
];

export const DEPARTMENTS: readonly DepartmentDefinition[] = DEFINITIONS.map((d) => {
  const canonical = getCanonicalDepartment(d.id);
  return { ...d, name: canonical.name, description: canonical.description };
});

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
