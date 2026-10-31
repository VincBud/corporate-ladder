/**
 * Maps a finished Reconciliation Rush round to a career history record.
 * Only summary figures are copied; the challenge, its solution and the
 * player's sheet never leave the game module.
 */
import type { GameResultInput } from "@/types/progression";
import type { FinishedRound } from "./machine";
import { correctionAccuracy } from "./report";

export const RECONCILIATION_RUSH_GAME_ID = "reconciliation-rush" as const;
/** Bump when scoring rules change so personal bests aren't compared across rule sets. */
export const RECONCILIATION_RUSH_SCORING_VERSION = 1;
export const RECONCILIATION_RUSH_DIFFICULTY = "associate";

export function toGameResult(round: FinishedRound, completedAt: Date): GameResultInput {
  const { evaluation, score, challenge } = round;
  return {
    gameId: RECONCILIATION_RUSH_GAME_ID,
    scoringVersion: RECONCILIATION_RUSH_SCORING_VERSION,
    seed: challenge.seed,
    department: challenge.department,
    difficulty: RECONCILIATION_RUSH_DIFFICULTY,
    completedAt: completedAt.toISOString(),
    completion: round.outcome === "completed" ? "submitted" : "timedOut",
    score: score.total,
    maxScore: score.maxPossible,
    grade: round.grade,
    errorsFixed: evaluation.fixedCount,
    totalErrors: evaluation.errors.length,
    incorrectCorrections: evaluation.incorrectCount,
    accuracy: correctionAccuracy(evaluation),
    timeUsedMs: Math.round(round.elapsedMs),
    timeRemainingMs: Math.round(round.remainingMs),
    assistanceUsed: round.assistanceUsed,
  };
}
