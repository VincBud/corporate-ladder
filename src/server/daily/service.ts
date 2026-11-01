/**
 * Daily Challenges (trusted server code). One shared puzzle per assignment
 * and UTC day; one ranked attempt per player, reserved when the round starts.
 *
 * The rounds themselves are ordinary verified sessions: hints and submissions
 * go through the existing game services, which generate the puzzle from the
 * day's shared seed and seal the review for daily rounds. XP, contribution
 * events, careers and achievements follow from finalize_game_session as for
 * any verified round.
 *
 * Retrying a request is not a new attempt: starting again returns the same
 * session with its original deadline ("resumed"), submitting again returns
 * the stored result. Once the round is final, the attempt is used.
 */
import { DAILY_ASSIGNMENTS, getDailyAssignment, isDailyAssignmentId, nextUtcMidnight, utcDate, type DailyAssignmentId } from "@/daily/assignments";
import type { DailyAttemptState, DailyChallengeView, DailyOfficialResult, DailyOverview, DailyStartResponse } from "@/types/daily";
import type { PipelineRoundService } from "../pipeline/service";
import { RoundError, fromDatabaseError } from "../rounds/errors";
import type { RpcCall } from "../rounds/round-store";
import type { VerifiedRoundService } from "../rounds/service";

/**
 * Ranking within one challenge (games are ranked separately; every player of
 * a challenge has the same puzzle and maximum, so raw scores are comparable):
 *   1. higher verified score  2. less time used  3. unassisted before assisted
 *   4. earlier completion     5. session id (final, arbitrary but stable)
 * Only official (finalized) results rank; test accounts are excluded.
 */
export const DAILY_RANKING_POLICY = ["score desc", "time_used_ms asc", "assistance_used asc", "completed_at asc", "session_id asc"] as const;

export interface DailyLeaderboardRow {
  rank: number;
  score: number;
  maxScore: number;
  completion: "submitted" | "timedOut";
  timeUsedMs: number;
  assistanceUsed: boolean;
  /** Whether this row is the viewer's own result. No other identity is included. */
  isViewer: boolean;
}

export interface DailyLeaderboard {
  challengeId: string;
  participants: number;
  rows: DailyLeaderboardRow[];
}

export interface DailyService {
  overview(userId: string | null): Promise<DailyOverview>;
  start(userId: string, assignmentId: unknown): Promise<DailyStartResponse>;
  /** Finalizes the player's expired daily round (as timed out). True if it did. */
  settleExpired(userId: string): Promise<boolean>;
  /** Aggregate ranking for a future leaderboard UI. Anonymous except for the viewer's own row. */
  leaderboard(challengeId: string, viewerId: string | null, limit?: number): Promise<DailyLeaderboard>;
}

type Json = Record<string, unknown>;

interface EntryRow {
  id: string;
  assignment_id: string;
  challenge_date: string;
  generation_version: number;
  rules_version: number;
  opens_at: string;
  closes_at: string;
  attempt: {
    session_id: string;
    session_status: "active" | "finalized" | "abandoned";
    started_at: string;
    deadline_at: string;
    result: {
      score: number;
      max_score: number;
      completion: "submitted" | "timedOut";
      time_used_ms: number;
      time_remaining_ms: number;
      assistance_used: boolean;
      completed_at: string;
      xp_awarded: number;
      errors_fixed: number;
      total_errors: number;
      incorrect_corrections: number;
    } | null;
    standing: { rank: number; participants: number } | null;
  } | null;
}

const iso = (value: string) => new Date(value).toISOString();
const CHALLENGE_ID = /^[a-z][a-z0-9-]{2,40}:\d{4}-\d{2}-\d{2}$/;

function toResult(row: NonNullable<NonNullable<EntryRow["attempt"]>["result"]>): DailyOfficialResult {
  return {
    score: row.score,
    maxScore: row.max_score,
    completion: row.completion,
    timeUsedMs: row.time_used_ms,
    timeRemainingMs: row.time_remaining_ms,
    assistanceUsed: row.assistance_used,
    completedAt: iso(row.completed_at),
    xpAwarded: row.xp_awarded,
    correct: row.errors_fixed,
    total: row.total_errors,
    mistakes: row.incorrect_corrections,
  };
}

function stateOf(entry: EntryRow, now: number, isToday: boolean): DailyAttemptState {
  const attempt = entry.attempt;
  if (!attempt) return isToday ? "available" : "missed";
  if (attempt.result) return attempt.result.completion === "submitted" ? "completed" : "timedOut";
  // Not finalized yet: running until its deadline, then timed out (settled on the next visit).
  return attempt.session_status === "active" && now <= Date.parse(attempt.deadline_at) ? "inProgress" : "timedOut";
}

function toView(entry: EntryRow, now: number, isToday: boolean, signedIn: boolean): DailyChallengeView | null {
  if (!isDailyAssignmentId(entry.assignment_id)) return null;
  return {
    challengeId: entry.id,
    assignmentId: entry.assignment_id,
    date: String(entry.challenge_date).slice(0, 10),
    rulesVersion: entry.rules_version,
    generationVersion: entry.generation_version,
    opensAt: iso(entry.opens_at),
    closesAt: iso(entry.closes_at),
    status: now < Date.parse(entry.closes_at) ? "open" : "closed",
    state: signedIn ? stateOf(entry, now, isToday) : null,
    attempt:
      signedIn && entry.attempt
        ? {
            sessionId: entry.attempt.session_id,
            startedAt: iso(entry.attempt.started_at),
            deadlineAt: iso(entry.attempt.deadline_at),
            result: entry.attempt.result ? toResult(entry.attempt.result) : null,
            standing: entry.attempt.standing,
          }
        : null,
  };
}

/**
 * Guests see today's schedule without touching the database: no challenge
 * rows are created by anonymous traffic, and nothing about the puzzle exists here.
 */
export function guestOverview(now: Date): DailyOverview {
  const date = utcDate(now);
  const opensAt = new Date(`${date}T00:00:00.000Z`).toISOString();
  const closesAt = nextUtcMidnight(now).toISOString();
  return {
    serverNow: now.toISOString(),
    date,
    nextResetAt: closesAt,
    signedIn: false,
    today: DAILY_ASSIGNMENTS.map((a) => ({
      challengeId: `${a.id}:${date}`,
      assignmentId: a.id,
      date,
      rulesVersion: null,
      generationVersion: a.generationVersion,
      opensAt,
      closesAt,
      status: "open",
      state: null,
      attempt: null,
    })),
    history: [],
  };
}

export function createDailyService({ rpc, rush, pipeline }: { rpc: RpcCall; rush: VerifiedRoundService; pipeline: PipelineRoundService }): DailyService {
  async function call(fn: string, args: Record<string, unknown>): Promise<unknown> {
    try {
      return await rpc(fn, args);
    } catch (error) {
      throw fromDatabaseError(error instanceof Error ? error.message : String(error)) ?? error;
    }
  }

  const gameService = (gameId: string) => (gameId === "pipeline-panic" ? pipeline : rush);

  async function settleExpired(userId: string): Promise<boolean> {
    const active = (await call("get_active_daily_session", { p_user_id: userId })) as Json | null;
    if (!active || !active.expired) return false;
    // A late submission is scored with nothing entered: a timed-out official result.
    await gameService(String(active.game_id)).submitRound(userId, String(active.session_id), {});
    return true;
  }

  /** Runs `start`, settling an expired daily round once if it was in the way. */
  async function afterSettling<T>(userId: string, start: () => Promise<T>): Promise<T> {
    try {
      return await start();
    } catch (error) {
      if (error instanceof RoundError && error.code === "daily_in_progress" && (await settleExpired(userId))) return start();
      throw error;
    }
  }

  async function resume(userId: string, assignmentId: DailyAssignmentId, sessionId: string, challengeId: string, status: "started" | "resumed"): Promise<DailyStartResponse> {
    const base = { status, challengeId, assignmentId };
    try {
      if (getDailyAssignment(assignmentId).gameId === "pipeline-panic") {
        const { round, hint } = await pipeline.resumeRound(userId, sessionId);
        return { ...base, gameId: "pipeline-panic", round, hint };
      }
      const { round, hint } = await rush.resumeRound(userId, sessionId);
      return { ...base, gameId: "reconciliation-rush", round, hint };
    } catch (error) {
      // The attempt exists but its round is over: record it officially (if it expired) and refuse a new one.
      if (error instanceof RoundError && error.code === "session_closed") {
        await settleExpired(userId);
        throw new RoundError("daily_attempt_used");
      }
      throw error;
    }
  }

  return {
    settleExpired,

    async overview(userId) {
      if (userId) await settleExpired(userId);
      const data = (await call("get_daily_status", { p_user_id: userId, p_history_days: 7 })) as Json;
      const now = Date.parse(String(data.db_now));
      const signedIn = userId !== null;
      const views = (rows: unknown, isToday: boolean) =>
        ((rows as EntryRow[]) ?? []).map((e) => toView(e, now, isToday, signedIn)).filter((v): v is DailyChallengeView => v !== null);
      return {
        serverNow: new Date(now).toISOString(),
        date: String(data.date).slice(0, 10),
        nextResetAt: iso(String(data.next_reset_at)),
        signedIn,
        today: views(data.today, true),
        history: signedIn ? views(data.history, false) : [],
      };
    },

    async start(userId, assignmentId) {
      if (!isDailyAssignmentId(assignmentId)) throw new RoundError("unknown_daily_challenge");
      const reserved = (await afterSettling(userId, () => call("start_daily_attempt", { p_user_id: userId, p_assignment_id: assignmentId }))) as Json;
      const status = reserved.status === "started" ? "started" : "resumed";
      return resume(userId, assignmentId, String(reserved.session_id), String(reserved.challenge_id), status);
    },

    async leaderboard(challengeId, viewerId, limit = 50) {
      if (!CHALLENGE_ID.test(challengeId)) throw new RoundError("unknown_daily_challenge");
      const data = (await call("get_daily_leaderboard", { p_challenge_id: challengeId, p_limit: limit })) as Json;
      const rows = (data.rows as Json[]) ?? [];
      return {
        challengeId,
        participants: Number(data.participants),
        rows: rows.map((r) => ({
          rank: Number(r.rank),
          score: Number(r.score),
          maxScore: Number(r.max_score),
          completion: r.completion as DailyLeaderboardRow["completion"],
          timeUsedMs: Number(r.time_used_ms),
          assistanceUsed: Boolean(r.assistance_used),
          isViewer: viewerId !== null && r.user_id === viewerId,
        })),
      };
    },
  };
}

/** Starts a practice round, first settling an expired daily round that would block it. */
export async function startAfterDailySettlement<T>(daily: DailyService | null, userId: string, start: () => Promise<T>): Promise<T> {
  try {
    return await start();
  } catch (error) {
    if (daily && error instanceof RoundError && error.code === "daily_in_progress" && (await daily.settleExpired(userId))) return start();
    throw error;
  }
}
