export type GameModeCategory = "Multiplayer" | "Solo" | "Advanced";

export interface GameMode {
  id: string;
  name: string;
  category: GameModeCategory;
  format: string;
  estimatedLength: string;
  description: string;
  status: "available" | "planned";
  /** Extra facts shown on playable mode cards. */
  details?: readonly string[];
}

export const GAME_MODES: readonly GameMode[] = [
  {
    id: "reconciliation-rush",
    name: "Reconciliation Rush",
    category: "Solo",
    format: "Timed run",
    estimatedLength: "90 sec",
    description: "Five errors. Ninety seconds. Find the numbers that don't add up before the auditors do.",
    status: "available",
    details: ["Solo", "90 seconds", "5 errors", "Associate"],
  },
  {
    id: "formula-duel",
    name: "Formula Duel",
    category: "Multiplayer",
    format: "Ranked 1v1",
    estimatedLength: "~3 min",
    description: "Race a colleague on the same task. Fastest correct formula wins.",
    status: "planned",
  },
  {
    id: "pivot-sprint",
    name: "Pivot Sprint",
    category: "Advanced",
    format: "Tournament bracket",
    estimatedLength: "~15 min",
    description: "Bracket-style pivot table challenges. Winner gets visibility.",
    status: "planned",
  },
];
