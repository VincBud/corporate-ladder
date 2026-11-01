import { describe, expect, it } from "vitest";
import { evaluatePipeline } from "./evaluate";
import { generatePipelineRound } from "./generate";
import { createPipelineHint } from "./hints";
import { PIPELINE_ROUND_DURATION_MS, initialPipelineState, pipelineReducer, type PipelineState } from "./machine";
import { buildPipelineReview } from "./review";
import { scorePipeline } from "./scoring";
import { solveRound } from "./solve";
import type { PipelineDecision, PipelineDecisions, PipelineRound } from "./types";

const round = generatePipelineRound("review-redaction");
const solved = solveRound(round);
const ids = round.opportunities.map((o) => o.id);
const wrong = (d: PipelineDecision): PipelineDecision => (d.action === "reject" ? { action: "defer" } : { action: "reject" });

/** First three correct, next two wrong, the rest left undecided. */
const decisions: PipelineDecisions = Object.fromEntries([
  ...ids.slice(0, 3).map((id) => [id, solved[id].decision]),
  ...ids.slice(3, 5).map((id) => [id, wrong(solved[id].decision)]),
]);
const undecidedIds = ids.slice(5);
const review = buildPipelineReview({ round, decisions, remainingMs: 30_000, durationMs: PIPELINE_ROUND_DURATION_MS, hint: null });
const fullEvaluation = evaluatePipeline(round, decisions);

describe("Decision Review redaction", () => {
  it("explains correctly attempted opportunities", () => {
    for (const id of ids.slice(0, 3)) {
      const outcome = review.outcomes.find((o) => o.id === id)!;
      expect(outcome.kind).toBe("correct");
      if (outcome.kind === "undecided") throw new Error("unexpected");
      expect(outcome.explanation.length).toBeGreaterThan(20);
      expect(outcome.bestDecision).toEqual(solved[id].decision);
      expect(outcome.points).toBeGreaterThan(0);
    }
  });

  it("shows the best decision, explanation and penalty for wrong attempts", () => {
    for (const id of ids.slice(3, 5)) {
      const outcome = review.outcomes.find((o) => o.id === id)!;
      if (outcome.kind === "undecided") throw new Error("unexpected");
      expect(outcome.kind).not.toBe("correct");
      expect(outcome.decision).toEqual(decisions[id]);
      expect(outcome.bestDecision).toEqual(solved[id].decision);
      expect(outcome.explanation).toBe(fullEvaluation.outcomes.find((o) => o.id === id)!.explanation);
      expect(outcome.points).toBeLessThan(0);
    }
  });

  it("reveals nothing about unattempted opportunities", () => {
    for (const id of undecidedIds) {
      const outcome = review.outcomes.find((o) => o.id === id)!;
      expect(outcome).toEqual({ id, decision: null, kind: "undecided" });
    }
    const json = JSON.stringify(review);
    for (const id of undecidedIds) {
      const hidden = fullEvaluation.outcomes.find((o) => o.id === id)!;
      expect(json).not.toContain(hidden.explanation);
    }
    // No seed (it regenerates every answer) and no scenario labels or difficulties.
    expect(json).not.toContain(round.seed);
    expect(json).not.toMatch(/"scenarios"|"difficulty"|"resolution"|"reason"/);
    expect(Object.keys(review.round).sort()).toEqual(["opportunities", "playbook", "quarterLabel"]);
  });

  it("drops a hint that points at an unattempted opportunity, keeps one about an attempted one", () => {
    const aboutUndecided = { opportunityId: undecidedIds[0], message: "Check the redlines for X.", requestedAtMs: 1 };
    expect(buildPipelineReview({ round, decisions, remainingMs: 0, durationMs: PIPELINE_ROUND_DURATION_MS, hint: aboutUndecided }).hint).toBeNull();
    const aboutAttempted = { opportunityId: ids[3], message: "Check the notes for Y.", requestedAtMs: 1 };
    expect(buildPipelineReview({ round, decisions, remainingMs: 0, durationMs: PIPELINE_ROUND_DURATION_MS, hint: aboutAttempted }).hint).toEqual(aboutAttempted);
    const nothing = createPipelineHint(round, Object.fromEntries(ids.map((id) => [id, solved[id].decision])), 5);
    expect(buildPipelineReview({ round, decisions, remainingMs: 0, durationMs: PIPELINE_ROUND_DURATION_MS, hint: nothing }).hint).toEqual(nothing);
  });

  it("keeps the score identical to full scoring", () => {
    expect(review.score).toEqual(scorePipeline(round, fullEvaluation, 30_000, PIPELINE_ROUND_DURATION_MS));
    expect({ correct: review.correctCount, mistakes: review.mistakeCount, undecided: review.undecidedCount }).toEqual({
      correct: fullEvaluation.correctCount,
      mistakes: fullEvaluation.mistakeCount,
      undecided: fullEvaluation.undecidedCount,
    });
  });

  it("redacts the same way for submitted and timed-out local rounds", () => {
    const finish = (outcome: "completed" | "timedOut", now: number) => {
      let state: PipelineState = pipelineReducer(initialPipelineState, { type: "openBriefing", round: round as PipelineRound });
      state = pipelineReducer(state, { type: "start", now: 0, sessionId: "s" });
      for (const [id, decision] of Object.entries(decisions)) state = pipelineReducer(state, { type: "decide", id, decision });
      state = pipelineReducer(state, { type: "finish", now, outcome });
      if (state.phase !== "results") throw new Error("not finished");
      return state.finished;
    };
    const submitted = finish("completed", 40_000);
    const timedOut = finish("timedOut", 95_000);
    expect(submitted.outcomes).toEqual(timedOut.outcomes);
    expect(timedOut.outcomes.filter((o) => o.kind === "undecided").map((o) => o.id)).toEqual(undecidedIds);
    expect(timedOut.score.timeBonus).toBe(0);
    // The local seed stays in memory for the guest history, but isn't part of the review data.
    expect(timedOut.localSeed).toBe(round.seed);
    expect(JSON.stringify({ ...timedOut, localSeed: null })).not.toContain(round.seed);
  });
});
