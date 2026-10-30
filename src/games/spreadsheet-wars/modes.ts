export interface GameMode {
  id: string;
  name: string;
  format: string;
  description: string;
}

/** Planned modes. None are playable yet. */
export const PLANNED_MODES: readonly GameMode[] = [
  {
    id: "formula-duel",
    name: "Formula Duel",
    format: "Ranked 1v1",
    description: "Race a colleague on the same task. Fastest correct formula wins.",
  },
  {
    id: "reconciliation-rush",
    name: "Reconciliation Rush",
    format: "Solo · Timed",
    description: "Find the numbers that don't add up before the auditors do.",
  },
  {
    id: "pivot-sprint",
    name: "Pivot Sprint",
    format: "Tournament",
    description: "Bracket-style pivot table challenges. Winner gets visibility.",
  },
];
