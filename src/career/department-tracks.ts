/**
 * Department careers: one track of positions per canonical department, and
 * the v0.1 progression policy.
 *
 * Department careers are separate from Corporate XP (global, never reset)
 * and from company contribution (follows the game played, never the
 * department).
 *
 * Progression policy v0.1 (derived, never stored, never invented):
 *   Tier 0       Entry position, on joining.
 *   Tiers 1–2    Earned with qualifying verified rounds in a live game that
 *                feeds the department's metrics, completed while a member
 *                of that department (any membership period counts, so
 *                returning to a department resumes the career there).
 *                Qualifying = verified, submitted in time, at least 80% of
 *                discrepancies fixed; each puzzle seed counts once.
 *                Today only Reconciliation Rush exists, which feeds
 *                Controlling and Finance.
 *   Departments without a live game stay at the entry position.
 *   Tier 3+      Requires Quarterly Performance Reviews (not implemented).
 */
import type { CanonicalDepartmentId } from "@/config/departments";
import { getMetric } from "@/simulation/departments";
import { LIVE_GAME_RULES, PLANNED_GAME_RULES, type GameContributionRule } from "@/simulation/games";
import type { GameResultRecord } from "@/types/progression";

export interface CareerPosition {
  id: string;
  title: string;
  /** One-line, slightly satirical job description. */
  summary: string;
}

const position = (id: string, title: string, summary: string): CareerPosition => ({ id, title, summary });

export const DEPARTMENT_TRACKS: Readonly<Record<CanonicalDepartmentId, readonly CareerPosition[]>> = {
  finance: [
    position("finance-intern", "Finance Intern", "Learns where the coffee and the cost centers are."),
    position("junior-analyst", "Junior Analyst", "Builds the spreadsheet everyone else will copy."),
    position("analyst", "Analyst", "Explains the numbers to people who already decided."),
    position("senior-analyst", "Senior Analyst", "Owns a forecast and the blame that comes with it."),
    position("associate", "Associate", "Presents the deck the analysts built overnight."),
    position("vice-president", "Vice President", "One of many. Approves things in principle."),
    position("managing-director", "Managing Director", "Has a corner office and a corner of the budget."),
    position("cfo", "Chief Financial Officer", "Signs the quarterly earnings and the expense policy."),
  ],
  controlling: [
    position("controlling-intern", "Controlling Intern", "Ticks the boxes on the reconciliation checklist."),
    position("junior-controller", "Junior Controller", "Finds the discrepancies before audit does."),
    position("controller", "Controller", "Asks why the numbers moved, then asks again."),
    position("senior-controller", "Senior Controller", "Explains variances in fewer than three slides."),
    position("controlling-manager", "Controlling Manager", "Runs the monthly close and the monthly mood."),
    position("head-of-controlling", "Head of Controlling", "Owns the internal reporting and its footnotes."),
    position("cfo", "Chief Financial Officer", "Signs the quarterly earnings and the expense policy."),
  ],
  people: [
    position("hr-intern", "HR Intern", "Updates the org chart after every reorg."),
    position("hr-assistant", "HR Assistant", "Schedules the onboarding nobody attends."),
    position("recruiter", "Recruiter", "Describes every role as fast-paced and exciting."),
    position("hr-business-partner", "HR Business Partner", "Partners with the business. Mostly in meetings."),
    position("hr-manager", "HR Manager", "Owns the employee handbook, all 400 pages."),
    position("hr-director", "HR Director", "Plans the culture, the offsite and the survey."),
    position("chro", "Chief Human Resources Officer", "Responsible for everyone's feelings, officially."),
  ],
  sales: [
    position("sales-intern", "Sales Intern", "Updates the CRM so others don't have to."),
    position("sdr", "Sales Development Representative", "Books meetings with anyone who picks up."),
    position("account-executive", "Account Executive", "Closes deals and expense reports."),
    position("senior-account-executive", "Senior Account Executive", "Owns the big accounts and the big lunches."),
    position("sales-manager", "Sales Manager", "Forecasts optimism with two decimal places."),
    position("sales-director", "Sales Director", "Owns a region and its golf courses."),
    position("vp-sales", "VP Sales", "Sets the quota and the motivational playlist."),
    position("cro", "Chief Revenue Officer", "Personally responsible for the hockey stick."),
  ],
  operations: [
    position("operations-intern", "Operations Intern", "Counts things, then counts them again."),
    position("operations-coordinator", "Operations Coordinator", "Knows where every pallet is, approximately."),
    position("supply-chain-analyst", "Supply Chain Analyst", "Turns delays into dashboards."),
    position("logistics-specialist", "Logistics Specialist", "Moves things from where they are to where they should be."),
    position("operations-manager", "Operations Manager", "Runs the floor and the escalation calls."),
    position("director-supply-chain", "Director of Supply Chain", "Negotiates with suppliers and with physics."),
    position("coo", "Chief Operating Officer", "Makes the company actually do the things it promised."),
  ],
  it: [
    position("it-intern", "IT Intern", "Turns it off and on again, professionally."),
    position("service-desk-technician", "Service Desk Technician", "Resets passwords with empathy."),
    position("junior-engineer", "Junior Engineer", "Fixes bugs, introduces new ones."),
    position("software-engineer", "Software Engineer", "Estimates everything at two weeks."),
    position("senior-engineer", "Senior Engineer", "Says \"it depends\" with authority."),
    position("engineering-manager", "Engineering Manager", "Moves tickets between columns."),
    position("director-engineering", "Director of Engineering", "Owns the roadmap and the outage reports."),
    position("cto", "Chief Technology Officer", "Approves the cloud bill, eventually."),
  ],
  marketing: [
    position("marketing-intern", "Marketing Intern", "Runs the social accounts nobody else wants."),
    position("marketing-coordinator", "Marketing Coordinator", "Keeps the campaign calendar mostly accurate."),
    position("content-specialist", "Content Specialist", "Writes ten headlines for every one used."),
    position("brand-manager", "Brand Manager", "Defends the logo's clear space."),
    position("senior-brand-manager", "Senior Brand Manager", "Leads the rebrand of the last rebrand."),
    position("marketing-director", "Marketing Director", "Owns the budget and the brand book."),
    position("cmo", "Chief Marketing Officer", "Turns synergy into a strategy and back."),
  ],
  legal: [
    position("legal-intern", "Legal Intern", "Reads the terms and conditions. All of them."),
    position("paralegal", "Paralegal", "Keeps the contracts and the deadlines in order."),
    position("associate-counsel", "Associate Counsel", "Adds the clauses nobody asked for."),
    position("corporate-counsel", "Corporate Counsel", "Says \"it depends\" for a living."),
    position("senior-counsel", "Senior Counsel", "Negotiates the contracts others signed too early."),
    position("deputy-general-counsel", "Deputy General Counsel", "Approves the disclaimers on the disclaimers."),
    position("general-counsel", "General Counsel", "Keeps the company out of the news."),
  ],
  strategy: [
    position("strategy-intern", "Strategy Intern", "Formats the slides for the strategy offsite."),
    position("business-analyst", "Business Analyst", "Builds the 2×2 matrix."),
    position("strategy-associate", "Strategy Associate", "Benchmarks competitors nobody has heard of."),
    position("strategy-manager", "Strategy Manager", "Owns the five-year plan for this quarter."),
    position("director-strategy", "Director of Strategy", "Picks the framework of the year."),
    position("vp-corporate-strategy", "VP Corporate Strategy", "Aligns the alignment."),
    position("cso", "Chief Strategy Officer", "Sets the vision, then the next one."),
  ],
};

export const DEPARTMENT_PROGRESSION = {
  /** Share of discrepancies fixed for a round to qualify. */
  qualifyingResolution: 0.8,
  /** Qualifying rounds needed for each gameplay-earned tier. */
  roundsForTier: { 1: 3, 2: 10 } as Readonly<Record<number, number>>,
  /** Highest tier earnable through gameplay in v0.1. */
  maxGameplayTier: 2,
} as const;

export type PositionRequirement =
  | { kind: "entry" }
  | { kind: "verifiedRounds"; rounds: number; games: string[] }
  /** The department has no live game yet. */
  | { kind: "departmentGameplay"; plannedGames: string[] }
  /** Quarterly Performance Reviews (planned). */
  | { kind: "performanceReview" };

function feedsDepartment(rule: GameContributionRule, departmentId: string): boolean {
  return Object.keys(rule.metricWeights).some((metric) => getMetric(metric)?.departmentId === departmentId);
}

/** Live games whose work belongs to this department (from the contribution configuration). */
export function progressionGames(departmentId: string): GameContributionRule[] {
  return LIVE_GAME_RULES.filter((rule) => feedsDepartment(rule, departmentId));
}

/** Planned games for the department: simulation's planned games plus registry extras. */
export function plannedGames(departmentId: string, extra: readonly string[] = []): string[] {
  return [...PLANNED_GAME_RULES.filter((rule) => feedsDepartment(rule, departmentId)).map((rule) => rule.title), ...extra];
}

export function requirementFor(departmentId: CanonicalDepartmentId, tier: number, extraPlanned: readonly string[] = []): PositionRequirement {
  if (tier === 0) return { kind: "entry" };
  if (tier > DEPARTMENT_PROGRESSION.maxGameplayTier) return { kind: "performanceReview" };
  const games = progressionGames(departmentId);
  if (games.length === 0) return { kind: "departmentGameplay", plannedGames: plannedGames(departmentId, extraPlanned) };
  return { kind: "verifiedRounds", rounds: DEPARTMENT_PROGRESSION.roundsForTier[tier], games: games.map((g) => g.title) };
}

export interface MembershipPeriod {
  departmentId: string;
  startedAt: string;
  endedAt: string | null;
}

/** Qualifying verified rounds completed while a member of the department (each seed once). */
export function qualifyingRounds(departmentId: string, memberships: readonly MembershipPeriod[], records: readonly GameResultRecord[]): number {
  const games = new Set(progressionGames(departmentId).map((g) => g.gameId));
  const periods = memberships
    .filter((m) => m.departmentId === departmentId)
    .map((m) => [Date.parse(m.startedAt), m.endedAt ? Date.parse(m.endedAt) : Infinity] as const);
  const seeds = new Set<string>();
  for (const record of records) {
    if (!games.has(record.gameId) || record.completion !== "submitted") continue;
    if (record.totalErrors <= 0 || record.errorsFixed / record.totalErrors < DEPARTMENT_PROGRESSION.qualifyingResolution) continue;
    const at = Date.parse(record.completedAt);
    if (periods.some(([start, end]) => at >= start && at < end)) seeds.add(`${record.gameId}:${record.seed}`);
  }
  return seeds.size;
}

export interface DepartmentProgress {
  departmentId: CanonicalDepartmentId;
  positionIndex: number;
  qualifyingRounds: number;
  /** The next position and what it takes, or null at the top of the track. */
  next: { index: number; requirement: PositionRequirement; remaining: number | null } | null;
}

export function departmentProgress(
  departmentId: CanonicalDepartmentId,
  memberships: readonly MembershipPeriod[],
  records: readonly GameResultRecord[],
  extraPlanned: readonly string[] = [],
): DepartmentProgress {
  const track = DEPARTMENT_TRACKS[departmentId];
  const rounds = qualifyingRounds(departmentId, memberships, records);
  let positionIndex = 0;
  for (let tier = 1; tier < track.length; tier++) {
    const requirement = requirementFor(departmentId, tier, extraPlanned);
    if (requirement.kind === "verifiedRounds" && rounds >= requirement.rounds) positionIndex = tier;
    else break;
  }
  const nextIndex = positionIndex + 1;
  if (nextIndex >= track.length) return { departmentId, positionIndex, qualifyingRounds: rounds, next: null };
  const requirement = requirementFor(departmentId, nextIndex, extraPlanned);
  return {
    departmentId,
    positionIndex,
    qualifyingRounds: rounds,
    next: { index: nextIndex, requirement, remaining: requirement.kind === "verifiedRounds" ? Math.max(0, requirement.rounds - rounds) : null },
  };
}
