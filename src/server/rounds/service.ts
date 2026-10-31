/**
 * Verified Reconciliation Rush lifecycle (trusted server code).
 *
 *   start  → the server picks a secret seed, the database records the start
 *            time and deadline, the client receives the public puzzle only.
 *   hint   → computed here from the player's current sheet; stored once.
 *   submit → the client sends committed cell contents only. The server
 *            rebuilds the challenge from the seed and pinned rules version,
 *            judges timing with database time, scores, and finalizes exactly
 *            once. XP is derived from the score inside the database.
 *
 * Server-side verification stops forged scores, times and XP. It does not
 * stop a player from getting outside help or automating play.
 */
import { randomBytes } from "node:crypto";
import { NOTHING_TO_FLAG_MESSAGE, createHint, describeHint, type RoundHint } from "@/games/spreadsheet-wars/reconciliation-rush/hints";
import { serializeChallenge, serializePublicChallenge, toPublicChallenge } from "@/games/spreadsheet-wars/reconciliation-rush/public";
import { correctionAccuracy, gradeRound } from "@/games/spreadsheet-wars/reconciliation-rush/report";
import { RECONCILIATION_RUSH_DIFFICULTY } from "@/games/spreadsheet-wars/reconciliation-rush/result";
import { scoreRound } from "@/games/spreadsheet-wars/reconciliation-rush/scoring";
import type { Challenge } from "@/games/spreadsheet-wars/reconciliation-rush/types";
import { evaluateRound, type PlayerEntries } from "@/games/spreadsheet-wars/reconciliation-rush/validate";
import type { GameResultRecord } from "@/types/progression";
import type { HintResponse, StartRoundResponse, SubmitRoundResponse } from "@/types/verified-play";
import { RoundError } from "./errors";
import { parseEntries } from "./payload";
import type { ResultRow, RoundStore, SessionRow } from "./round-store";
import { RECONCILIATION_RUSH, challengeFor } from "./rules";

const NO_TARGET = "none";

/** 128-bit secret seed: infeasible to guess or brute-force from the public puzzle. */
export function createVerifiedSeed(): string {
  return `RV1-${randomBytes(16).toString("hex")}`;
}

export interface SubmissionTiming {
  completion: "submitted" | "timedOut";
  /** Whether the submitted cells are scored. Late submissions are not. */
  acceptEntries: boolean;
  elapsedMs: number;
  remainingMs: number;
}

/**
 * Judges a submission using database timestamps only.
 *   before the deadline            → submitted, scored, time bonus possible
 *   within the network tolerance   → timed out, scored, no time bonus
 *   later                          → timed out, cells ignored (could have been edited after time)
 */
export function judgeSubmissionTiming(session: Pick<SessionRow, "startedAt" | "deadlineAt" | "toleranceMs" | "dbNow">): SubmissionTiming {
  const now = session.dbNow.getTime();
  const start = session.startedAt.getTime();
  const deadline = session.deadlineAt.getTime();
  const duration = deadline - start;
  if (now <= deadline) {
    const remainingMs = deadline - now;
    return { completion: "submitted", acceptEntries: true, elapsedMs: duration - remainingMs, remainingMs };
  }
  return { completion: "timedOut", acceptEntries: now <= deadline + session.toleranceMs, elapsedMs: duration, remainingMs: 0 };
}

export function resultRowToRecord(row: ResultRow): GameResultRecord {
  return {
    id: row.session_id,
    gameId: RECONCILIATION_RUSH,
    scoringVersion: row.rules_version,
    seed: row.seed,
    department: row.department,
    difficulty: row.difficulty,
    completedAt: new Date(row.completed_at).toISOString(),
    completion: row.completion,
    score: row.score,
    maxScore: row.max_score,
    grade: row.grade,
    errorsFixed: row.errors_fixed,
    totalErrors: row.total_errors,
    incorrectCorrections: row.incorrect_corrections,
    accuracy: row.accuracy === null ? null : Number(row.accuracy),
    timeUsedMs: row.time_used_ms,
    timeRemainingMs: row.time_remaining_ms,
    assistanceUsed: row.assistance_used,
    xpAwarded: row.xp_awarded,
  };
}

function storedHint(challenge: Challenge, errorId: string, requestedAtMs: number): RoundHint {
  const error = errorId === NO_TARGET ? undefined : challenge.errors.find((e) => e.id === errorId);
  if (!error) return { errorId: null, row: null, documentNumber: null, message: NOTHING_TO_FLAG_MESSAGE, requestedAtMs };
  const doc = challenge.documents.find((d) => d.id === error.documentId);
  return {
    errorId: error.id,
    row: error.address.row,
    documentNumber: doc?.number ?? null,
    message: describeHint(challenge, error),
    requestedAtMs,
  };
}

function sessionHint(session: SessionRow, challenge: Challenge): RoundHint | null {
  if (!session.hintErrorId || !session.hintRequestedAt) return null;
  return storedHint(challenge, session.hintErrorId, session.hintRequestedAt.getTime() - session.startedAt.getTime());
}

export interface VerifiedRoundService {
  startRound(userId: string): Promise<StartRoundResponse>;
  requestHint(userId: string, sessionId: string, body: unknown): Promise<HintResponse>;
  submitRound(userId: string, sessionId: string, body: unknown): Promise<SubmitRoundResponse>;
}

export function createVerifiedRoundService({
  store,
  createSeed = createVerifiedSeed,
}: {
  store: RoundStore;
  createSeed?: () => string;
}): VerifiedRoundService {
  async function loadOwned(userId: string, sessionId: string) {
    const session = await store.getSession(sessionId, userId);
    // Someone else's session looks exactly like a missing one.
    if (!session) throw new RoundError("not_found");
    return { session, challenge: challengeFor(session.rulesVersion, session.seed) };
  }

  /** Rebuilds the full response from what was stored, so retries get identical answers. */
  function buildResponse(session: SessionRow, challenge: Challenge, row: ResultRow, created: boolean, totalXp: number): SubmitRoundResponse {
    const entries: PlayerEntries = row.submission ?? {};
    const evaluation = evaluateRound(challenge, entries);
    const score = scoreRound(evaluation, row.time_remaining_ms, session.durationMs);
    return {
      record: resultRowToRecord(row),
      created,
      totalXp,
      review: {
        challenge: serializeChallenge(challenge),
        entries,
        outcome: row.completion === "submitted" ? "completed" : "timedOut",
        elapsedMs: row.time_used_ms,
        remainingMs: row.time_remaining_ms,
        durationMs: session.durationMs,
        evaluation,
        score,
        grade: gradeRound(evaluation),
        hint: sessionHint(session, challenge),
        assistanceUsed: row.assistance_used,
      },
    };
  }

  return {
    async startRound(userId) {
      const created = await store.createSession(userId, RECONCILIATION_RUSH, createSeed());
      const session = await store.getSession(created.sessionId, userId);
      if (!session) throw new RoundError("not_found");
      const challenge = challengeFor(session.rulesVersion, session.seed);
      return {
        sessionId: created.sessionId,
        challenge: serializePublicChallenge(toPublicChallenge(challenge)),
        rulesVersion: created.rulesVersion,
        startedAt: created.startedAt.toISOString(),
        serverNow: created.dbNow.toISOString(),
        durationMs: created.durationMs,
      };
    },

    async requestHint(userId, sessionId, body) {
      const { session, challenge } = await loadOwned(userId, sessionId);
      const existing = sessionHint(session, challenge);
      if (existing) return { hint: existing }; // one hint per round; repeats return it
      const timing = judgeSubmissionTiming(session);
      if (session.status !== "active" || timing.completion === "timedOut") throw new RoundError("session_closed");

      const entries = parseEntries(body, challenge);
      const hint = createHint(challenge, entries, timing.elapsedMs);
      const recorded = await store.recordHint(sessionId, userId, hint.errorId ?? NO_TARGET);
      return {
        hint: storedHint(challenge, recorded.errorId, recorded.requestedAt.getTime() - session.startedAt.getTime()),
      };
    },

    async submitRound(userId, sessionId, body) {
      const { session, challenge } = await loadOwned(userId, sessionId);

      // Already final: return the stored result. New cells are ignored and no XP is added.
      if (session.status === "finalized" && session.result) {
        return buildResponse(session, challenge, session.result, false, session.totalXp);
      }
      if (session.status !== "active") throw new RoundError("session_closed");

      const timing = judgeSubmissionTiming(session);
      const entries = timing.acceptEntries ? parseEntries(body, challenge) : {};
      const evaluation = evaluateRound(challenge, entries);
      const score = scoreRound(evaluation, timing.remainingMs, session.durationMs);

      const finalized = await store.finalize(
        sessionId,
        userId,
        {
          department: challenge.department,
          difficulty: RECONCILIATION_RUSH_DIFFICULTY,
          completion: timing.completion,
          score: score.total,
          max_score: score.maxPossible,
          grade: gradeRound(evaluation),
          errors_fixed: evaluation.fixedCount,
          total_errors: evaluation.errors.length,
          incorrect_corrections: evaluation.incorrectCount,
          accuracy: correctionAccuracy(evaluation),
          time_used_ms: Math.round(timing.elapsedMs),
          time_remaining_ms: Math.round(timing.remainingMs),
        },
        entries,
      );
      // A concurrent request may have finalized first; the stored row wins either way.
      return buildResponse(session, challenge, finalized.result, finalized.created, finalized.totalXp);
    },
  };
}
