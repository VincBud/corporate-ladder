/** API contract for Daily Challenges. Never contains seeds or answers. */
import type { RoundHint } from "@/games/spreadsheet-wars/reconciliation-rush/hints";
import type { PipelineHint } from "@/games/pipeline-panic/hints";
import type { DailyAssignmentId } from "@/daily/assignments";
import type { StartPipelineResponse } from "./pipeline-play";
import type { StartRoundResponse } from "./verified-play";

/** Available → In progress → Completed | Timed out. Past days without an attempt: Missed. */
export type DailyAttemptState = "available" | "inProgress" | "completed" | "timedOut" | "missed";

export interface DailyOfficialResult {
  score: number;
  maxScore: number;
  completion: "submitted" | "timedOut";
  timeUsedMs: number;
  timeRemainingMs: number;
  assistanceUsed: boolean;
  completedAt: string;
  xpAwarded: number;
  correct: number;
  total: number;
  mistakes: number;
}

export interface DailyChallengeView {
  /** Stable public id, e.g. "daily-audit:2026-11-01". */
  challengeId: string;
  assignmentId: DailyAssignmentId;
  date: string;
  /** Pinned when the challenge is created; null in the guest preview. */
  rulesVersion: number | null;
  generationVersion: number;
  opensAt: string;
  closesAt: string;
  status: "open" | "closed";
  /** The signed-in player's state; null for guests. */
  state: DailyAttemptState | null;
  attempt: {
    sessionId: string;
    startedAt: string;
    deadlineAt: string;
    result: DailyOfficialResult | null;
    /** Current standing among official results (test accounts excluded). */
    standing: { rank: number; participants: number } | null;
  } | null;
}

export interface DailyOverview {
  serverNow: string;
  date: string;
  nextResetAt: string;
  signedIn: boolean;
  today: DailyChallengeView[];
  /** Signed-in players only: recent days, newest first. */
  history: DailyChallengeView[];
}

interface DailyStartBase {
  /** "resumed": the same session as before, with its original deadline. */
  status: "started" | "resumed";
  challengeId: string;
  assignmentId: DailyAssignmentId;
}

export type DailyStartResponse =
  | (DailyStartBase & { gameId: "reconciliation-rush"; round: StartRoundResponse; hint: RoundHint | null })
  | (DailyStartBase & { gameId: "pipeline-panic"; round: StartPipelineResponse; hint: PipelineHint | null });

/** Attached to submit responses of daily rounds, which carry no review. */
export interface DailyRoundLink {
  challengeId: string;
  assignmentId: string;
  date: string;
  closesAt: string;
}
