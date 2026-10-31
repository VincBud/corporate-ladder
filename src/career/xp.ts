/**
 * Corporate XP awards. XP is derived from a game's score but is a separate
 * currency: scores rank rounds, XP drives career progression.
 */
import type { GameResultInput, GameResultRecord } from "@/types/progression";

/** One Corporate XP per 20 score points (unchanged from the original preview formula). */
export const SCORE_POINTS_PER_XP = 20;

export type XpAwardReason =
  /** XP earned from the round's score. */
  | "score"
  /** Score too low to earn XP (including 0). */
  | "noScore"
  /** This exact case (game + seed) was completed before; replays earn nothing. */
  | "repeatCase";

export interface XpAward {
  xp: number;
  reason: XpAwardReason;
}

export function xpForScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.floor(Math.max(0, score) / SCORE_POINTS_PER_XP);
}

/**
 * XP for a newly finished round, given the player's earlier history.
 * Basic farming protection: a seeded case only pays out the first time.
 * This is local solo progression, not a security boundary.
 */
export function calculateXpAward(
  result: Pick<GameResultInput, "gameId" | "seed" | "score">,
  history: readonly Pick<GameResultRecord, "gameId" | "seed">[],
): XpAward {
  const xp = xpForScore(result.score);
  // A score worth nothing is explained as such, even on a replay.
  if (xp === 0) return { xp: 0, reason: "noScore" };
  if (history.some((record) => record.gameId === result.gameId && record.seed === result.seed)) {
    return { xp: 0, reason: "repeatCase" };
  }
  return { xp, reason: "score" };
}
