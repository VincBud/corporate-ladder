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
import { createHash, randomBytes } from "node:crypto";
import { NOTHING_TO_FLAG_MESSAGE, createHint, describeHint, type RoundHint } from "@/games/spreadsheet-wars/reconciliation-rush/hints";
import { serializeChallenge, serializePublicChallenge, toPublicChallenge } from "@/games/spreadsheet-wars/reconciliation-rush/public";
import { correctionAccuracy, gradeRound } from "@/games/spreadsheet-wars/reconciliation-rush/report";
import { RECONCILIATION_RUSH_DIFFICULTY } from "@/games/spreadsheet-wars/reconciliation-rush/result";
import { scoreRound } from "@/games/spreadsheet-wars/reconciliation-rush/scoring";
import type { Challenge } from "@/games/spreadsheet-wars/reconciliation-rush/types";
import { evaluateRound, type PlayerEntries } from "@/games/spreadsheet-wars/reconciliation-rush/validate";
import { GAME_IDS, type GameId, type GameResultRecord } from "@/types/progression";
import type { DailyRoundLink } from "@/types/daily";
import type { HintResponse, StartRoundResponse, SubmitRoundResponse } from "@/types/verified-play";
import { RoundError } from "./errors";
import { parseEntries } from "./payload";
import type { ContributionOutcome, ResultPayload, ResultRow, RoundStore, SessionRow } from "./round-store";
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

/**
 * Opaque stand-in for a verified round's secret seed in records sent to the
 * browser. The seed regenerates the whole puzzle, including answers the
 * player never saw; the reference only allows "same puzzle" comparisons
 * (e.g. each puzzle counts once for department careers).
 */
export function seedReference(seed: string): string {
  return `ref-${createHash("sha256").update(seed).digest("hex").slice(0, 24)}`;
}

/** Daily rounds: what the client may know about the challenge (no seed). */
export function dailyRoundLink(session: SessionRow): DailyRoundLink | undefined {
  if (!session.daily) return undefined;
  const { challengeId, assignmentId, challengeDate, closesAt } = session.daily;
  return { challengeId, assignmentId, date: challengeDate, closesAt: closesAt.toISOString() };
}

export function resultRowToRecord(row: ResultRow): GameResultRecord {
  if (!(GAME_IDS as readonly string[]).includes(row.game_id)) throw new Error(`Unknown game in results: ${row.game_id}`);
  return {
    id: row.session_id,
    gameId: row.game_id as GameId,
    scoringVersion: row.rules_version,
    seed: seedReference(row.seed),
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

/** The stored result as a finalize payload (ignored by the database once a round is final). */
function payloadFromRow(row: ResultRow): ResultPayload {
  return {
    department: row.department,
    difficulty: row.difficulty,
    completion: row.completion,
    score: row.score,
    max_score: row.max_score,
    grade: row.grade,
    errors_fixed: row.errors_fixed,
    total_errors: row.total_errors,
    incorrect_corrections: row.incorrect_corrections,
    accuracy: row.accuracy === null ? null : Number(row.accuracy),
    time_used_ms: row.time_used_ms,
    time_remaining_ms: row.time_remaining_ms,
  };
}

export interface VerifiedRoundService {
  startRound(userId: string): Promise<StartRoundResponse>;
  /** The public puzzle of an existing active session, with its original start (resume after reload). */
  resumeRound(userId: string, sessionId: string): Promise<{ round: StartRoundResponse; hint: RoundHint | null }>;
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
    // Someone else's session, or another game's, looks exactly like a missing one.
    if (!session || session.gameId !== RECONCILIATION_RUSH) throw new RoundError("not_found");
    return { session, challenge: challengeFor(session.rulesVersion, session.puzzleSeed) };
  }

  function startResponse(session: SessionRow, challenge: Challenge): StartRoundResponse {
    return {
      sessionId: session.sessionId,
      challenge: serializePublicChallenge(toPublicChallenge(challenge)),
      rulesVersion: session.rulesVersion,
      startedAt: session.startedAt.toISOString(),
      serverNow: session.dbNow.toISOString(),
      durationMs: session.durationMs,
    };
  }

  /** Rebuilds the full response from what was stored, so retries get identical answers. */
  function buildResponse(
    session: SessionRow,
    challenge: Challenge,
    row: ResultRow,
    created: boolean,
    totalXp: number,
    contribution: ContributionOutcome | null,
  ): SubmitRoundResponse {
    const base = {
      record: resultRowToRecord(row),
      contribution: { recorded: contribution?.status === "created" || contribution?.status === "duplicate" },
      created,
      totalXp,
    };
    // Ranked daily rounds share one puzzle: the review would reveal answers
    // (including for cells the player never touched) to everyone still to play.
    if (session.daily) return { ...base, review: null, daily: dailyRoundLink(session) };
    const entries: PlayerEntries = row.submission ?? {};
    const evaluation = evaluateRound(challenge, entries);
    const score = scoreRound(evaluation, row.time_remaining_ms, session.durationMs);
    return {
      ...base,
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
      const { session, challenge } = await loadOwned(userId, created.sessionId);
      return startResponse(session, challenge);
    },

    async resumeRound(userId, sessionId) {
      const { session, challenge } = await loadOwned(userId, sessionId);
      if (session.status !== "active" || judgeSubmissionTiming(session).completion === "timedOut") throw new RoundError("session_closed");
      return { round: startResponse(session, challenge), hint: sessionHint(session, challenge) };
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
      // Finalizing again is a no-op that also records a missing contribution event (recovery).
      if (session.status === "finalized" && session.result) {
        const stored = await store.finalize(sessionId, userId, payloadFromRow(session.result), session.result.submission ?? {});
        return buildResponse(session, challenge, stored.result, false, stored.totalXp, stored.contribution);
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
      return buildResponse(session, challenge, finalized.result, finalized.created, finalized.totalXp, finalized.contribution);
    },
  };
}
