/**
 * Canonical department identifiers, shared by player profiles (Supabase
 * `departments` table) and the company simulation.
 *
 * Must match the seeded rows after all migrations (a test checks this).
 * Ids are permanent: profiles reference them, so they are never renamed or
 * deleted. Retire a department by changing its kind or adding a status
 * column, never by removing the row.
 *
 *   operating  has operational metrics in the company simulation
 *   support    valid for membership; no metrics yet
 *
 * Membership and contribution attribution are separate. A player's
 * department never decides which metrics their rounds feed; the game does
 * (src/simulation/games.ts).
 */

export interface CanonicalDepartment {
  id: string;
  name: string;
  kind: "operating" | "support";
}

export const CANONICAL_DEPARTMENTS: readonly CanonicalDepartment[] = [
  { id: "finance", name: "Finance", kind: "operating" },
  { id: "controlling", name: "Controlling", kind: "operating" },
  { id: "people", name: "Human Resources", kind: "operating" },
  { id: "sales", name: "Sales", kind: "operating" },
  { id: "operations", name: "Operations & Supply Chain", kind: "operating" },
  { id: "it", name: "IT & Engineering", kind: "operating" },
  { id: "marketing", name: "Marketing", kind: "operating" },
  { id: "legal", name: "Legal", kind: "support" },
  { id: "strategy", name: "Strategy", kind: "support" },
];
