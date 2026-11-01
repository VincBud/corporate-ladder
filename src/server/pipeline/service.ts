/**
 * Verified Pipeline Panic lifecycle (trusted server code). Same guarantees
 * as Reconciliation Rush: the server picks a secret seed, the database keeps
 * the clock, the client sends decisions only, and the server rebuilds the
 * round, scores it and finalizes it exactly once. XP and the company
 * contribution event are created inside finalize_game_session.
 */
import { randomBytes } from "node:crypto";
import { evaluatePipeline } from "@/games/pipeline-panic/evaluate";
import { NOTHING_TO_REVIEW_MESSAGE, createPipelineHint, describePipelineHint, type PipelineHint } from "@/games/pipeline-panic/hints";
import { toPublicPipelineRound } from "@/games/pipeline-panic/public";
import { decisionAccuracy, gradePipeline } from "@/games/pipeline-panic/report";
import { buildPipelineReview } from "@/games/pipeline-panic/review";
import { PIPELINE_PANIC_DEPARTMENT, PIPELINE_PANIC_DIFFICULTY } from "@/games/pipeline-panic/result";
import { scorePipeline } from "@/games/pipeline-panic/scoring";
import type { PipelineRound } from "@/games/pipeline-panic/types";
import type { PipelineHintResponse, StartPipelineResponse, SubmitPipelineResponse } from "@/types/pipeline-play";
import { RoundError } from "../rounds/errors";
import type { ContributionOutcome, ResultRow, RoundStore, SessionRow } from "../rounds/round-store";
import { judgeSubmissionTiming, resultRowToRecord } from "../rounds/service";
import { decodeDecisions, encodeDecisions, parseDecisions } from "./payload";
import { PIPELINE_PANIC, pipelineRoundFor } from "./rules";

const NO_TARGET = "none";

export function createPipelineSeed(): string {
  return `PP1-${randomBytes(16).toString("hex")}`;
}

function storedHint(round: PipelineRound, opportunityId: string, requestedAtMs: number): PipelineHint {
  if (opportunityId === NO_TARGET || !round.opportunities.some((o) => o.id === opportunityId)) {
    return { opportunityId: null, message: NOTHING_TO_REVIEW_MESSAGE, requestedAtMs };
  }
  return { opportunityId, message: describePipelineHint(round, opportunityId), requestedAtMs };
}

function sessionHint(session: SessionRow, round: PipelineRound): PipelineHint | null {
  if (!session.hintErrorId || !session.hintRequestedAt) return null;
  return storedHint(round, session.hintErrorId, session.hintRequestedAt.getTime() - session.startedAt.getTime());
}

export interface PipelineRoundService {
  startRound(userId: string): Promise<StartPipelineResponse>;
  requestHint(userId: string, sessionId: string, body: unknown): Promise<PipelineHintResponse>;
  submitRound(userId: string, sessionId: string, body: unknown): Promise<SubmitPipelineResponse>;
}

export function createPipelineRoundService({ store, createSeed = createPipelineSeed }: { store: RoundStore; createSeed?: () => string }): PipelineRoundService {
  async function loadOwned(userId: string, sessionId: string) {
    const session = await store.getSession(sessionId, userId);
    // Someone else's session, or another game's, looks exactly like a missing one.
    if (!session || session.gameId !== PIPELINE_PANIC) throw new RoundError("not_found");
    return { session, round: pipelineRoundFor(session.rulesVersion, session.seed) };
  }

  function buildResponse(
    session: SessionRow,
    round: PipelineRound,
    row: ResultRow,
    created: boolean,
    totalXp: number,
    contribution: ContributionOutcome | null,
  ): SubmitPipelineResponse {
    const decisions = decodeDecisions(row.submission);
    return {
      record: resultRowToRecord(row),
      contribution: { recorded: contribution?.status === "created" || contribution?.status === "duplicate" },
      created,
      totalXp,
      review: {
        ...buildPipelineReview({ round, decisions, remainingMs: row.time_remaining_ms, durationMs: session.durationMs, hint: sessionHint(session, round) }),
        decisions,
        outcome: row.completion === "submitted" ? "completed" : "timedOut",
        elapsedMs: row.time_used_ms,
        remainingMs: row.time_remaining_ms,
        durationMs: session.durationMs,
        assistanceUsed: row.assistance_used,
      },
    };
  }

  return {
    async startRound(userId) {
      const created = await store.createSession(userId, PIPELINE_PANIC, createSeed());
      const session = await store.getSession(created.sessionId, userId);
      if (!session) throw new RoundError("not_found");
      const round = pipelineRoundFor(session.rulesVersion, session.seed);
      return {
        sessionId: session.sessionId,
        round: toPublicPipelineRound(round),
        rulesVersion: session.rulesVersion,
        startedAt: session.startedAt.toISOString(),
        serverNow: session.dbNow.toISOString(),
        durationMs: session.durationMs,
      };
    },

    async requestHint(userId, sessionId, body) {
      const { session, round } = await loadOwned(userId, sessionId);
      if (session.hintErrorId && session.hintRequestedAt) {
        return { hint: storedHint(round, session.hintErrorId, session.hintRequestedAt.getTime() - session.startedAt.getTime()) };
      }
      const timing = judgeSubmissionTiming(session);
      if (session.status !== "active" || timing.completion === "timedOut") throw new RoundError("session_closed");
      const hint = createPipelineHint(round, parseDecisions(body, round), timing.elapsedMs);
      const recorded = await store.recordHint(sessionId, userId, hint.opportunityId ?? NO_TARGET);
      return { hint: storedHint(round, recorded.errorId, recorded.requestedAt.getTime() - session.startedAt.getTime()) };
    },

    async submitRound(userId, sessionId, body) {
      const { session, round } = await loadOwned(userId, sessionId);

      // Already final: finalizing again is a no-op that also recovers a missing contribution event.
      if (session.status === "finalized" && session.result) {
        const row = session.result;
        const stored = await store.finalize(
          sessionId,
          userId,
          {
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
          },
          row.submission ?? {},
        );
        return buildResponse(session, round, stored.result, false, stored.totalXp, stored.contribution);
      }
      if (session.status !== "active") throw new RoundError("session_closed");

      const timing = judgeSubmissionTiming(session);
      const decisions = timing.acceptEntries ? parseDecisions(body, round) : {};
      const evaluation = evaluatePipeline(round, decisions);
      const score = scorePipeline(round, evaluation, timing.remainingMs, session.durationMs);
      const finalized = await store.finalize(
        sessionId,
        userId,
        {
          department: PIPELINE_PANIC_DEPARTMENT,
          difficulty: PIPELINE_PANIC_DIFFICULTY,
          completion: timing.completion,
          score: score.total,
          max_score: score.maxPossible,
          grade: gradePipeline(evaluation),
          errors_fixed: evaluation.correctCount,
          total_errors: evaluation.total,
          incorrect_corrections: evaluation.mistakeCount,
          accuracy: decisionAccuracy(evaluation),
          time_used_ms: Math.round(timing.elapsedMs),
          time_remaining_ms: Math.round(timing.remainingMs),
        },
        encodeDecisions(decisions),
      );
      return buildResponse(session, round, finalized.result, finalized.created, finalized.totalXp, finalized.contribution);
    },
  };
}
