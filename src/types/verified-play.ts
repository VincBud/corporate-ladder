/**
 * API contract for verified (server-scored) Reconciliation Rush rounds.
 * Shared by the browser client and the route handlers.
 */
import type { RoundHint } from "@/games/spreadsheet-wars/reconciliation-rush/hints";
import type { RoundOutcome } from "@/games/spreadsheet-wars/reconciliation-rush/machine";
import type { SerializedChallenge, SerializedPublicChallenge } from "@/games/spreadsheet-wars/reconciliation-rush/public";
import type { PerformanceGrade } from "@/games/spreadsheet-wars/reconciliation-rush/report";
import type { ScoreBreakdown } from "@/games/spreadsheet-wars/reconciliation-rush/scoring";
import type { PlayerEntries, RoundEvaluation } from "@/games/spreadsheet-wars/reconciliation-rush/validate";
import type { AchievementUnlock } from "./achievements";
import type { DailyRoundLink } from "./daily";
import type { GameResultRecord } from "./progression";

export interface StartRoundResponse {
  sessionId: string;
  /** Public puzzle only: no solutions, planted errors or seed. */
  challenge: SerializedPublicChallenge;
  rulesVersion: number;
  /** Server timestamps (ISO). The client only uses them to display the countdown. */
  startedAt: string;
  serverNow: string;
  durationMs: number;
}

export interface HintResponse {
  hint: RoundHint;
}

/** Everything needed to show the report and review once a round is final. */
export interface VerifiedRoundReview {
  challenge: SerializedChallenge;
  entries: PlayerEntries;
  outcome: RoundOutcome;
  elapsedMs: number;
  remainingMs: number;
  durationMs: number;
  evaluation: RoundEvaluation;
  score: ScoreBreakdown;
  grade: PerformanceGrade;
  hint: RoundHint | null;
  assistanceUsed: boolean;
}

export interface SubmitRoundResponse {
  record: GameResultRecord;
  /**
   * Whether this round is part of the company's verified contribution
   * ledger. Only a flag: no points, allocation or ranking for the player.
   */
  contribution: { recorded: boolean };
  /** Achievements this submission unlocked (empty on retries). */
  achievements?: AchievementUnlock[];
  /** False when this request returned a result stored by an earlier request. */
  created: boolean;
  totalXp: number;
  /**
   * Null for ranked Daily Challenge rounds: the puzzle is shared, so answers
   * stay sealed (see docs/daily-challenges.md).
   */
  review: VerifiedRoundReview | null;
  /** Set for ranked Daily Challenge rounds. */
  daily?: DailyRoundLink;
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}
