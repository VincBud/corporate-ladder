/** Maps a finished Pipeline Panic round to a career history record (summary figures only). */
import type { GameResultInput } from "@/types/progression";
import type { FinishedPipelineReview } from "./review";

export const PIPELINE_PANIC_GAME_ID = "pipeline-panic" as const;
/** Bump when generation or scoring changes. */
export const PIPELINE_PANIC_SCORING_VERSION = 1;
export const PIPELINE_PANIC_DIFFICULTY = "associate";
export const PIPELINE_PANIC_DEPARTMENT = "Sales";

export interface FinishedPipelineSummary {
  seed: string;
  review: Pick<FinishedPipelineReview, "outcome" | "score" | "grade" | "correctCount" | "total" | "mistakeCount" | "undecidedCount" | "elapsedMs" | "remainingMs" | "assistanceUsed">;
}

export function toPipelineGameResult({ seed, review }: FinishedPipelineSummary, completedAt: Date): GameResultInput {
  const decided = review.total - review.undecidedCount;
  return {
    gameId: PIPELINE_PANIC_GAME_ID,
    scoringVersion: PIPELINE_PANIC_SCORING_VERSION,
    seed,
    department: PIPELINE_PANIC_DEPARTMENT,
    difficulty: PIPELINE_PANIC_DIFFICULTY,
    completedAt: completedAt.toISOString(),
    completion: review.outcome === "completed" ? "submitted" : "timedOut",
    score: review.score.total,
    maxScore: review.score.maxPossible,
    grade: review.grade,
    // Shared result fields: "errors fixed" = correct decisions, "incorrect corrections" = mistakes.
    errorsFixed: review.correctCount,
    totalErrors: review.total,
    incorrectCorrections: review.mistakeCount,
    accuracy: decided === 0 ? null : review.correctCount / decided,
    timeUsedMs: Math.round(review.elapsedMs),
    timeRemainingMs: Math.round(review.remainingMs),
    assistanceUsed: review.assistanceUsed,
  };
}
