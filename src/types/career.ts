export type RankId =
  | "unpaid-intern"
  | "intern"
  | "junior-associate"
  | "associate"
  | "senior-associate"
  | "team-lead"
  | "manager"
  | "senior-manager"
  | "director"
  | "vice-president"
  | "senior-vice-president"
  | "chief-synergy-officer"
  | "ceo";

export interface Rank {
  id: RankId;
  title: string;
  /** Minimum level required to hold this rank. */
  minLevel: number;
  /** Annual in-game salary in CorpBucks. Not real money. */
  salary: number;
  perk: string;
}

export interface LevelProgress {
  xp: number;
  level: number;
  levelStartXp: number;
  nextLevelXp: number;
  xpIntoLevel: number;
  xpToNextLevel: number;
  /** 0–1 progress through the current level. */
  ratio: number;
  isMaxLevel: boolean;
}

export interface CareerSnapshot {
  progress: LevelProgress;
  rank: Rank;
  nextRank: Rank | null;
  xpToNextRank: number;
}
