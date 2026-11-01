/**
 * The client-visible Decision Review. Built from the full round (server, or
 * the browser for guest rounds), then redacted:
 *
 *   attempted opportunities    the player's decision, the outcome, the best decision,
 *                              the explanation and the points
 *   unattempted opportunities  only "no decision": no best decision, explanation,
 *                              difficulty or anything else that hints at the answer
 *
 * The review also never carries the seed (which regenerates every answer) or
 * the scenario labels. Scores are computed from the full round, so redaction
 * never changes a score.
 */
import type { PerformanceGrade } from "@/games/spreadsheet-wars/reconciliation-rush/report";
import { evaluatePipeline, type OutcomeKind } from "./evaluate";
import type { PipelineHint } from "./hints";
import { toPublicPipelineRound } from "./public";
import { gradePipeline, pipelineFeedback } from "./report";
import { outcomePoints, scorePipeline, type PipelineScore } from "./scoring";
import type { PipelineDecision, PipelineDecisions, PipelineRound, PublicPipelineRound } from "./types";

export type ReviewedOutcome =
  | {
      id: string;
      decision: PipelineDecision;
      kind: Exclude<OutcomeKind, "undecided">;
      points: number;
      bestDecision: PipelineDecision;
      explanation: string;
      verdict: string;
    }
  | { id: string; decision: null; kind: "undecided" };

export interface PipelineReviewData {
  round: PublicPipelineRound;
  outcomes: ReviewedOutcome[];
  total: number;
  correctCount: number;
  mistakeCount: number;
  undecidedCount: number;
  score: PipelineScore;
  grade: PerformanceGrade;
  /** Manager feedback, chosen with the (unrevealed) seed. */
  feedback: string;
  /** The hint, only if its opportunity was attempted (otherwise it would point at an answer). */
  hint: PipelineHint | null;
  /** Attempted opportunities that passed on, or under-priced, a deal that should have closed. */
  missedCount: number;
}

/** Everything the report and review show for one finished round (client-safe). */
export interface FinishedPipelineReview extends PipelineReviewData {
  /** The player's own decisions (attempted opportunities only). */
  decisions: Record<string, PipelineDecision>;
  outcome: "completed" | "timedOut";
  elapsedMs: number;
  remainingMs: number;
  durationMs: number;
  assistanceUsed: boolean;
}

export interface BuildReviewInput {
  round: PipelineRound;
  decisions: PipelineDecisions;
  remainingMs: number;
  durationMs: number;
  hint: PipelineHint | null;
}

export function buildPipelineReview({ round, decisions, remainingMs, durationMs, hint }: BuildReviewInput): PipelineReviewData {
  const evaluation = evaluatePipeline(round, decisions);
  const score = scorePipeline(round, evaluation, remainingMs, durationMs);
  const grade = gradePipeline(evaluation);
  const outcomes: ReviewedOutcome[] = evaluation.outcomes.map((o) =>
    o.decision === null || o.kind === "undecided"
      ? { id: o.id, decision: null, kind: "undecided" }
      : {
          id: o.id,
          decision: o.decision,
          kind: o.kind,
          points: outcomePoints(round, o),
          bestDecision: o.resolution.decision,
          explanation: o.explanation,
          verdict: o.verdict,
        },
  );
  const attempted = (id: string | null) => id !== null && decisions[id] !== undefined;
  return {
    round: toPublicPipelineRound(round),
    outcomes,
    total: evaluation.total,
    correctCount: evaluation.correctCount,
    mistakeCount: evaluation.mistakeCount,
    undecidedCount: evaluation.undecidedCount,
    missedCount: evaluation.outcomes.filter((o) => o.kind === "missed").length,
    score,
    grade,
    feedback: pipelineFeedback(grade, round.seed),
    hint: hint && (hint.opportunityId === null || attempted(hint.opportunityId)) ? hint : null,
  };
}
