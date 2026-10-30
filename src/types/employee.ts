import type { AchievementId } from "./career";

/** The player's in-game employee identity. Entirely fictional. */
export interface Employee {
  id: string;
  displayName: string;
  employeeNumber: string;
  department: string;
  manager: string;
  location: string;
  xp: number;
  /** ISO date (YYYY-MM-DD). */
  joinedOn: string;
  unlockedAchievements: readonly AchievementId[];
  /** True until accounts exist; progress is not persisted for guests. */
  isGuest: boolean;
}
