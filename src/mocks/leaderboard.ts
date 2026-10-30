import type { LeaderboardRecord } from "@/types/leaderboard";

/**
 * MOCK DATA — fictional employees for layout purposes only.
 * No matches have been played and none of these are real users.
 */
export const MOCK_LEADERBOARD: readonly LeaderboardRecord[] = [
  { handle: "ctrl_alt_defeat", department: "Finance", xp: 151_200, wins: 412, losses: 88 },
  { handle: "pivot_queen", department: "Strategy", xp: 138_950, wins: 377, losses: 102 },
  { handle: "vlookup_vince", department: "Operations", xp: 121_400, wins: 344, losses: 131 },
  { handle: "q4_closer", department: "Sales", xp: 98_300, wins: 290, losses: 140 },
  { handle: "synergy_sam", department: "Marketing", xp: 84_750, wins: 251, losses: 149 },
  { handle: "reply_all_randy", department: "IT", xp: 72_100, wins: 219, losses: 171 },
  { handle: "kpi_kim", department: "HR", xp: 63_480, wins: 198, losses: 160 },
  { handle: "deck_builder", department: "Strategy", xp: 51_900, wins: 170, losses: 155 },
  { handle: "audit_trail", department: "Legal", xp: 40_250, wins: 141, losses: 139 },
  { handle: "cell_shock", department: "Finance", xp: 31_700, wins: 118, losses: 126 },
  { handle: "circle_back", department: "Sales", xp: 22_600, wins: 90, losses: 112 },
  { handle: "out_of_office", department: "Operations", xp: 9_850, wins: 41, losses: 77 },
];
