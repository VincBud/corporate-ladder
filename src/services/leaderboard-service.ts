import { MOCK_LEADERBOARD } from "@/mocks/leaderboard";
import type { LeaderboardEntry } from "@/types/leaderboard";

/**
 * Leaderboard data access. Backed by mock data until server-validated
 * scores exist. Future: query Postgres and subscribe to realtime updates.
 */
export const LEADERBOARD_SOURCE = "mock" as const;

export function getLeaderboard(): LeaderboardEntry[] {
  return [...MOCK_LEADERBOARD]
    .sort((a, b) => b.xp - a.xp)
    .map((record, index) => ({ ...record, position: index + 1 }));
}
