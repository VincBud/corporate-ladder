import type { AchievementId } from "@/career/achievements";

export interface AchievementUnlock {
  id: AchievementId;
  /** When the condition was first met (database time). */
  unlockedAt: string;
}

/** A signed-in player's achievements, computed by the server from authoritative data. */
export interface AchievementSummary {
  unlocked: AchievementUnlock[];
  /** Progress for counting achievements (current is capped at target). */
  progress: Partial<Record<AchievementId, { current: number; target: number }>>;
}
