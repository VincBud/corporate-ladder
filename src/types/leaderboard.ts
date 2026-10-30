export interface LeaderboardRecord {
  handle: string;
  department: string;
  xp: number;
  wins: number;
  losses: number;
}

export interface LeaderboardEntry extends LeaderboardRecord {
  position: number;
}
