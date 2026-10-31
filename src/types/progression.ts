/** Minigames that can produce results. Extend this union when a new game ships. */
export const GAME_IDS = ["reconciliation-rush"] as const;
export type GameId = (typeof GAME_IDS)[number];

export type CompletionType = "submitted" | "timedOut";

/**
 * One finished minigame round in the player's history.
 * Summary data only: never answer keys, solutions or sheet contents.
 */
export interface GameResultRecord {
  /** Session id, unique per played round. Also the duplicate-protection key. */
  id: string;
  gameId: GameId;
  /** Results are only compared with others of the same game, difficulty and scoring version. */
  scoringVersion: number;
  seed: string;
  department: string;
  difficulty: string;
  /** ISO 8601 timestamp. */
  completedAt: string;
  completion: CompletionType;
  score: number;
  maxScore: number;
  grade: string;
  errorsFixed: number;
  totalErrors: number;
  incorrectCorrections: number;
  /** 0–1, or null when no correction was attempted. */
  accuracy: number | null;
  timeUsedMs: number;
  timeRemainingMs: number;
  assistanceUsed: boolean;
  /** Corporate XP granted for this round (0 is valid). */
  xpAwarded: number;
}

/** What a game reports when a round finishes; the career system adds id and XP. */
export type GameResultInput = Omit<GameResultRecord, "id" | "xpAwarded">;
