/**
 * Canonical departments: the single registry shared by player profiles
 * (Supabase `departments` table), department careers and the company
 * simulation.
 *
 * Must match the seeded rows after all migrations (a test checks id, name
 * and kind). Ids are permanent: profiles and membership history reference
 * them, so they are never renamed or deleted.
 *
 *   operating  has operational metrics in the company simulation
 *   support    valid for membership and careers; no metrics yet
 *
 * Membership and contribution attribution are separate. A player's
 * department never decides which metrics their rounds feed; the game does
 * (src/simulation/games.ts).
 */

export const CANONICAL_DEPARTMENT_IDS = [
  "finance",
  "controlling",
  "people",
  "sales",
  "operations",
  "it",
  "marketing",
  "legal",
  "strategy",
] as const;
export type CanonicalDepartmentId = (typeof CANONICAL_DEPARTMENT_IDS)[number];

export interface CanonicalDepartment {
  id: CanonicalDepartmentId;
  name: string;
  kind: "operating" | "support";
  /** One line: what the department does. */
  description: string;
  /** The welcome note from the department head. */
  introduction: string;
  responsibilities: readonly string[];
  /** Future minigames not yet in the simulation's game list. */
  plannedGames?: readonly string[];
}

export const CANONICAL_DEPARTMENTS: readonly CanonicalDepartment[] = [
  {
    id: "finance",
    name: "Finance",
    kind: "operating",
    description: "Closes the books, forecasts the future and approves your expense report eventually.",
    introduction: "Welcome to Finance, where every number tells a story and most of them are about budget overruns.",
    responsibilities: ["Month-end close", "Forecasting and budgets", "Expense approvals"],
  },
  {
    id: "controlling",
    name: "Controlling",
    kind: "operating",
    description: "Reconciles ledgers, explains variances and asks why the numbers moved.",
    introduction: "Welcome to Controlling. If a number moved, we already have a meeting about it.",
    responsibilities: ["Ledger reconciliation", "Variance analysis", "Internal reporting"],
  },
  {
    id: "people",
    name: "Human Resources",
    kind: "operating",
    description: "Hires, onboards and schedules mandatory fun.",
    introduction: "Welcome to Human Resources. Your feelings are valid and have been logged in the system.",
    responsibilities: ["Recruiting and onboarding", "Employee requests", "Mandatory fun"],
  },
  {
    id: "sales",
    name: "Sales",
    kind: "operating",
    description: "Turns pipelines into revenue and lunches into pipelines.",
    introduction: "Welcome to Sales. Always be closing, especially browser tabs during demos.",
    responsibilities: ["Pipeline management", "Client negotiations", "Quarterly quota anxiety"],
  },
  {
    id: "operations",
    name: "Operations & Supply Chain",
    kind: "operating",
    description: "Moves things from where they are to where they should have been yesterday.",
    introduction: "Welcome to Operations. Everything is on schedule, for a generous definition of schedule.",
    responsibilities: ["Fulfilment", "Supplier coordination", "Inventory surprises"],
  },
  {
    id: "it",
    name: "IT & Engineering",
    kind: "operating",
    description: "Keeps the systems up and asks whether you tried turning it off and on again.",
    introduction: "Welcome to IT & Engineering. Please file a ticket to request your welcome.",
    responsibilities: ["Service desk", "Systems reliability", "Saying no to new tools"],
  },
  {
    id: "marketing",
    name: "Marketing",
    kind: "operating",
    description: "Builds the brand, one rebrand at a time.",
    introduction: "Welcome to Marketing. Our values are bold, authentic and currently being A/B tested.",
    responsibilities: ["Campaign planning", "Brand guidelines", "Rebrands"],
  },
  {
    id: "legal",
    name: "Legal",
    kind: "support",
    description: "Reads the fine print so nobody else has to, then adds more fine print.",
    introduction: "Welcome to Legal. This welcome message is provided without warranty of any kind.",
    responsibilities: ["Contract review", "Compliance", "Disclaimers"],
    plannedGames: ["Contract Redline"],
  },
  {
    id: "strategy",
    name: "Corporate Strategy",
    kind: "support",
    description: "Sets the five-year plan, revisited every quarter.",
    introduction: "Welcome to Corporate Strategy. We have a framework for that, and a framework for choosing frameworks.",
    responsibilities: ["Long-term planning", "Market analysis", "Slide decks"],
    plannedGames: ["Synergy Slide Deck"],
  },
];

const BY_ID = new Map(CANONICAL_DEPARTMENTS.map((d) => [d.id, d]));

export function isCanonicalDepartmentId(value: unknown): value is CanonicalDepartmentId {
  return typeof value === "string" && BY_ID.has(value as CanonicalDepartmentId);
}

export function getCanonicalDepartment(id: CanonicalDepartmentId): CanonicalDepartment {
  return BY_ID.get(id)!;
}

/** Display name for any stored department id (unknown ids fall back to the id). */
export function departmentDisplayName(id: string | null): string | null {
  if (id === null) return null;
  return isCanonicalDepartmentId(id) ? BY_ID.get(id)!.name : id;
}
