/**
 * Persistence for verified rounds, backed by the SQL functions in
 * supabase/migrations. The adapter takes a generic RPC function so the same
 * code runs against Supabase (service role) and against PGlite in tests.
 */
import { RoundError, fromDatabaseError } from "./errors";

export type RpcCall = (fn: string, args: Record<string, unknown>) => Promise<unknown>;

export interface SessionRow {
  sessionId: string;
  gameId: string;
  rulesVersion: number;
  /** The session's own seed (stored with the result; unique per session). */
  seed: string;
  /**
   * The seed the puzzle is generated from: the session seed, or for a ranked
   * Daily Challenge the day's shared seed. Never leaves the server.
   */
  puzzleSeed: string;
  /** Set when the session is a player's ranked Daily Challenge attempt. */
  daily: DailySessionLink | null;
  status: "active" | "finalized" | "abandoned";
  startedAt: Date;
  deadlineAt: Date;
  durationMs: number;
  toleranceMs: number;
  hintErrorId: string | null;
  hintRequestedAt: Date | null;
  dbNow: Date;
  result: ResultRow | null;
  /** The owner's current Corporate XP (sum of their ledger). */
  totalXp: number;
}

export interface DailySessionLink {
  challengeId: string;
  assignmentId: string;
  /** UTC date (YYYY-MM-DD). */
  challengeDate: string;
  closesAt: Date;
}

export interface CreatedSession {
  sessionId: string;
  rulesVersion: number;
  startedAt: Date;
  durationMs: number;
  dbNow: Date;
}

/** A row of public.game_results (snake_case, as stored). */
export interface ResultRow {
  session_id: string;
  user_id: string;
  game_id: string;
  rules_version: number;
  seed: string;
  department: string;
  difficulty: string;
  completion: "submitted" | "timedOut";
  score: number;
  max_score: number;
  grade: string;
  errors_fixed: number;
  total_errors: number;
  incorrect_corrections: number;
  accuracy: number | string | null;
  time_used_ms: number;
  time_remaining_ms: number;
  assistance_used: boolean;
  xp_awarded: number;
  submission: Record<string, string>;
  completed_at: string;
}

export interface ResultPayload {
  department: string;
  difficulty: string;
  completion: "submitted" | "timedOut";
  score: number;
  max_score: number;
  grade: string;
  errors_fixed: number;
  total_errors: number;
  incorrect_corrections: number;
  accuracy: number | null;
  time_used_ms: number;
  time_remaining_ms: number;
}

/** What finalize did about the company contribution event (server-internal; never sent to the browser). */
export interface ContributionOutcome {
  status: "created" | "duplicate" | "seed_replay" | "not_applicable";
  eventId: string | null;
}

export interface RoundStore {
  createSession(userId: string, gameId: string, seed: string): Promise<CreatedSession>;
  getSession(sessionId: string, userId: string): Promise<SessionRow | null>;
  recordHint(sessionId: string, userId: string, errorId: string): Promise<{ errorId: string; requestedAt: Date; created: boolean }>;
  finalize(
    sessionId: string,
    userId: string,
    result: ResultPayload,
    submission: Record<string, string>,
  ): Promise<{ result: ResultRow; created: boolean; totalXp: number; contribution: ContributionOutcome | null }>;
}

type Json = Record<string, unknown>;
const date = (value: unknown) => new Date(String(value));

function toDailyLink(data: Json): DailySessionLink {
  return {
    challengeId: String(data.challenge_id),
    assignmentId: String(data.assignment_id),
    challengeDate: String(data.challenge_date).slice(0, 10),
    closesAt: date(data.closes_at),
  };
}

export function createRpcRoundStore(rpc: RpcCall): RoundStore {
  async function call(fn: string, args: Record<string, unknown>): Promise<unknown> {
    try {
      return await rpc(fn, args);
    } catch (error) {
      const mapped = fromDatabaseError(error instanceof Error ? error.message : String(error));
      throw mapped ?? error;
    }
  }

  return {
    async createSession(userId, gameId, seed) {
      const data = (await call("create_game_session", { p_user_id: userId, p_game_id: gameId, p_seed: seed })) as Json;
      return {
        sessionId: String(data.session_id),
        rulesVersion: Number(data.rules_version),
        startedAt: date(data.started_at),
        durationMs: Number(data.duration_ms),
        dbNow: date(data.db_now),
      };
    },

    async getSession(sessionId, userId) {
      const data = (await call("get_game_session", { p_session_id: sessionId, p_user_id: userId })) as Json | null;
      if (!data) return null;
      return {
        sessionId: String(data.session_id),
        gameId: String(data.game_id),
        rulesVersion: Number(data.rules_version),
        seed: String(data.seed),
        puzzleSeed: String(data.puzzle_seed ?? data.seed),
        daily: data.daily ? toDailyLink(data.daily as Json) : null,
        status: data.status as SessionRow["status"],
        startedAt: date(data.started_at),
        deadlineAt: date(data.deadline_at),
        durationMs: Number(data.duration_ms),
        toleranceMs: Number(data.tolerance_ms),
        hintErrorId: (data.hint_error_id as string | null) ?? null,
        hintRequestedAt: data.hint_requested_at ? date(data.hint_requested_at) : null,
        dbNow: date(data.db_now),
        result: (data.result as ResultRow | null) ?? null,
        totalXp: Number(data.total_xp ?? 0),
      };
    },

    async recordHint(sessionId, userId, errorId) {
      const data = (await call("record_game_hint", { p_session_id: sessionId, p_user_id: userId, p_error_id: errorId })) as Json;
      return { errorId: String(data.hint_error_id), requestedAt: date(data.hint_requested_at), created: Boolean(data.created) };
    },

    async finalize(sessionId, userId, result, submission) {
      const data = (await call("finalize_game_session", {
        p_session_id: sessionId,
        p_user_id: userId,
        p_result: result,
        p_submission: submission,
      })) as Json;
      if (!data?.result) throw new RoundError("not_found");
      const contribution = data.contribution as { status: ContributionOutcome["status"]; event_id: string | null } | undefined;
      return {
        result: data.result as ResultRow,
        created: Boolean(data.created),
        totalXp: Number(data.total_xp),
        contribution: contribution ? { status: contribution.status, eventId: contribution.event_id ?? null } : null,
      };
    },
  };
}
