/** API contract for verified (server-scored) Pipeline Panic rounds. */
import type { PipelineHint } from "@/games/pipeline-panic/hints";
import type { FinishedPipelineReview } from "@/games/pipeline-panic/review";
import type { PublicPipelineRound } from "@/games/pipeline-panic/types";
import type { AchievementUnlock } from "./achievements";
import type { GameResultRecord } from "./progression";

export interface StartPipelineResponse {
  sessionId: string;
  /** Every fact the player needs; no seed and no answer labels. */
  round: PublicPipelineRound;
  rulesVersion: number;
  startedAt: string;
  serverNow: string;
  durationMs: number;
}

export interface PipelineHintResponse {
  hint: PipelineHint;
}


export interface SubmitPipelineResponse {
  record: GameResultRecord;
  contribution: { recorded: boolean };
  /** Achievements this submission unlocked (empty on retries). */
  achievements?: AchievementUnlock[];
  created: boolean;
  totalXp: number;
  /** Client-safe: unattempted opportunities carry no answer; no seed or answer labels. */
  review: FinishedPipelineReview;
}
