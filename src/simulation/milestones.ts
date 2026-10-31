/**
 * Company milestones. Each is reached once, in the first quarter its
 * condition holds, and stays reached.
 *
 * Adding a milestone: add a definition. `reached` sees the current quarter
 * and every earlier one (oldest first).
 */
import type { QuarterResult } from "./economy";
import type { PeriodId } from "./types";

export interface MilestoneDefinition {
  id: string;
  title: string;
  description: string;
  reached: (quarter: QuarterResult, earlier: readonly QuarterResult[]) => boolean;
}

export interface MilestoneStatus {
  id: string;
  title: string;
  description: string;
  /** Quarter in which it was first reached, or null. */
  reachedIn: PeriodId | null;
}

const growthStreak = (quarters: readonly QuarterResult[], length: number) => {
  if (quarters.length < length + 1) return false;
  const recent = quarters.slice(-(length + 1));
  return recent.every((q, i) => i === 0 || q.revenue > recent[i - 1].revenue);
};

export const MILESTONES: readonly MilestoneDefinition[] = [
  {
    id: "first-contribution",
    title: "First contribution",
    description: "Someone did something measurable.",
    reached: (q) => q.totalCreditedPoints > 0,
  },
  {
    id: "first-profit",
    title: "First profitable quarter",
    description: "Operating profit above zero.",
    reached: (q) => q.operatingProfit > 0,
  },
  {
    id: "margin-15",
    title: "Margin of safety",
    description: "Operating margin of 15% or more.",
    reached: (q) => q.profitMargin !== null && q.profitMargin >= 0.15,
  },
  {
    id: "revenue-25m",
    title: "25M CB quarter",
    description: "Quarterly revenue of 25,000,000 CB or more.",
    reached: (q) => q.revenue >= 25_000_000,
  },
  {
    id: "half-participation",
    title: "Half the workforce showed up",
    description: "At least 50% of employees contributed in one quarter.",
    reached: (q) => q.participationRate >= 0.5,
  },
  {
    id: "all-on-target",
    title: "Alignment achieved",
    description: "Every measured department on target (at least three measured).",
    reached: (q) => {
      const measured = q.departments.filter((d) => d.attainment !== null);
      return measured.length >= 3 && measured.every((d) => d.attainment! >= 0.9);
    },
  },
  {
    id: "growth-streak",
    title: "Three quarters of growth",
    description: "Revenue grew three quarters in a row.",
    reached: (q, earlier) => growthStreak([...earlier, q], 3),
  },
  {
    id: "headcount-600",
    title: "600 on payroll",
    description: "600 or more employees.",
    reached: (q) => q.employeeCount >= 600,
  },
];

/** Milestone status after the given quarters (oldest first). */
export function evaluateMilestones(
  quarters: readonly QuarterResult[],
  definitions: readonly MilestoneDefinition[] = MILESTONES,
): MilestoneStatus[] {
  return definitions.map((definition) => {
    const index = quarters.findIndex((q, i) => definition.reached(q, quarters.slice(0, i)));
    return {
      id: definition.id,
      title: definition.title,
      description: definition.description,
      reachedIn: index === -1 ? null : quarters[index].periodId,
    };
  });
}
