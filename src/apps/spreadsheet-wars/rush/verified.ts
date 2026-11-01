/** Converts verified-play API responses into the game's round types. */
import type { FinishedRound, VerifiedActiveRound } from "@/games/spreadsheet-wars/reconciliation-rush/machine";
import { deserializeChallenge, deserializePublicChallenge } from "@/games/spreadsheet-wars/reconciliation-rush/public";
import type { StartRoundResponse, SubmitRoundResponse } from "@/types/verified-play";

/**
 * The local countdown starts from when the response arrived, minus time that
 * had already passed on the server. Display only: the server keeps the
 * official clock.
 */
export function toVerifiedRound(response: StartRoundResponse, receivedAt: number): VerifiedActiveRound {
  const elapsedOnServer = Math.max(0, Date.parse(response.serverNow) - Date.parse(response.startedAt));
  return {
    mode: "verified",
    sessionId: response.sessionId,
    challenge: deserializePublicChallenge(response.challenge),
    startedAt: receivedAt - elapsedOnServer,
    durationMs: response.durationMs,
    entries: {},
    hint: null,
  };
}

export function toFinishedRound(sessionId: string, response: SubmitRoundResponse): FinishedRound {
  const review = response.review;
  // Practice rounds always carry a review; only ranked daily rounds (played in Daily Assignments) don't.
  if (!review) throw new Error("This round's review is sealed.");
  return {
    mode: "verified",
    sessionId,
    challenge: deserializeChallenge(review.challenge),
    startedAt: 0,
    durationMs: review.durationMs,
    entries: review.entries,
    hint: review.hint,
    assistanceUsed: review.assistanceUsed,
    outcome: review.outcome,
    elapsedMs: review.elapsedMs,
    remainingMs: review.remainingMs,
    evaluation: review.evaluation,
    score: review.score,
    grade: review.grade,
  };
}
