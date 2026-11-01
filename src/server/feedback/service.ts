/**
 * Employee Experience Survey submissions (trusted server code). Feedback is
 * private research data: it's stored through service-role functions only,
 * earns nothing, and never appears in company data or rankings.
 */
import { createHash } from "node:crypto";
import { SURVEY_VERSION, validateSubmission } from "@/feedback/survey";
import { RoundError, fromDatabaseError } from "../rounds/errors";
import type { RpcCall } from "../rounds/round-store";

export interface FeedbackReceipt {
  status: "created" | "duplicate";
  revision: number;
  submittedAt: string;
}

export interface FeedbackStatus {
  submitted: boolean;
  revision: number | null;
  submittedAt: string | null;
}

/** Guests are grouped by a hash of their random browser token; the token itself is never stored. */
export function respondentKey(userId: string | null, guestToken: string | undefined): string {
  if (userId) return `user:${userId}`;
  if (!guestToken) throw new RoundError("invalid_payload", "The request was not understood.");
  return `guest:${createHash("sha256").update(guestToken).digest("hex")}`;
}

async function call(rpc: RpcCall, fn: string, args: Record<string, unknown>) {
  try {
    return await rpc(fn, args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("invalid_feedback")) throw new RoundError("invalid_payload", "Please check your answers and try again.");
    if (message.includes("feedback_limit")) throw new RoundError("rate_limited", "You've already revised your feedback several times. Thank you!");
    throw fromDatabaseError(message) ?? error;
  }
}

export async function submitFeedback(rpc: RpcCall, userId: string | null, body: unknown): Promise<FeedbackReceipt> {
  const parsed = validateSubmission(body);
  if (!parsed.ok) throw new RoundError("invalid_payload", parsed.error);
  const s = parsed.value;
  const key = respondentKey(userId, s.guestToken);
  const data = (await call(rpc, "submit_feedback", {
    p_survey_version: SURVEY_VERSION,
    p_respondent_key: key,
    p_user_id: userId,
    p_request_id: s.requestId,
    p_payload: {
      ratings: {
        gameplay_fun: s.ratings.gameplayFun,
        ease_of_understanding: s.ratings.easeOfUnderstanding,
        playability: s.ratings.playability,
        replay_appeal: s.ratings.replayAppeal,
      },
      enjoyed: s.enjoyed ?? "",
      improve: s.improve ?? "",
      // Accounts: replaced by verified history inside the database.
      games_played: s.context.gamesPlayed,
      completed_rounds: s.context.completedRounds,
      device_category: s.context.deviceCategory,
    },
  })) as { status: FeedbackReceipt["status"]; revision: number; submitted_at: string };
  return { status: data.status, revision: Number(data.revision), submittedAt: new Date(data.submitted_at).toISOString() };
}

export async function feedbackStatus(rpc: RpcCall, userId: string): Promise<FeedbackStatus> {
  const data = (await call(rpc, "get_feedback_status", { p_survey_version: SURVEY_VERSION, p_respondent_key: `user:${userId}` })) as {
    submitted: boolean;
    revision?: number;
    submitted_at?: string;
  };
  return {
    submitted: Boolean(data.submitted),
    revision: data.revision ?? null,
    submittedAt: data.submitted_at ? new Date(data.submitted_at).toISOString() : null,
  };
}
