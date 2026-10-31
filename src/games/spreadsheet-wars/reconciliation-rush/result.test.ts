import { describe, expect, it } from "vitest";
import { cellKey } from "../sheet";
import {
  ROUND_DURATION_MS,
  initialSpreadsheetWarsState,
  spreadsheetWarsReducer as reduce,
  type LocalActiveRound,
  type SpreadsheetWarsState,
} from "./machine";
import { toGameResult } from "./result";

const T0 = 1_000;
const NOW = new Date("2026-10-30T12:00:00.000Z");

function start(sessionId = "session-1", seed = "RR-RESULT"): { phase: "playing"; round: LocalActiveRound } {
  const state = reduce(reduce(initialSpreadsheetWarsState, { type: "openBriefing", seed }), { type: "start", now: T0, sessionId });
  if (state.phase !== "playing" || state.round.mode !== "local") throw new Error();
  return { phase: "playing", round: state.round };
}

describe("Reconciliation Rush → career result", () => {
  it("maps a submitted round to a summary record", () => {
    const started = start();
    const { challenge } = started.round;
    let state: SpreadsheetWarsState = started;
    for (const error of challenge.errors) {
      const content = challenge.cells.get(cellKey(error.address))!.solution;
      state = reduce(state, { type: "commitCell", address: error.address, content, now: T0 + 1_000 });
    }
    state = reduce(state, { type: "submit", now: T0 + 30_000 });
    if (state.phase !== "results") throw new Error();
    const result = toGameResult(state.round, NOW);
    expect(result).toMatchObject({
      gameId: "reconciliation-rush",
      seed: "RR-RESULT",
      department: challenge.department,
      difficulty: "associate",
      completion: "submitted",
      completedAt: NOW.toISOString(),
      errorsFixed: 5,
      totalErrors: 5,
      incorrectCorrections: 0,
      accuracy: 1,
      timeUsedMs: 30_000,
      timeRemainingMs: 60_000,
      assistanceUsed: false,
      score: state.round.score.total,
      maxScore: state.round.score.maxPossible,
      grade: "Exceeds Expectations",
    });
  });

  it("maps timed-out and assisted rounds", () => {
    const hinted = reduce(start(), { type: "requestHint", now: T0 + 1_000 });
    const timedOut = reduce(hinted, { type: "tick", now: T0 + ROUND_DURATION_MS });
    if (timedOut.phase !== "results") throw new Error();
    expect(toGameResult(timedOut.round, NOW)).toMatchObject({
      completion: "timedOut",
      assistanceUsed: true,
      timeRemainingMs: 0,
      timeUsedMs: ROUND_DURATION_MS,
      accuracy: null,
      score: 0,
    });
  });

  it("never includes answer keys or sheet contents", () => {
    const state = reduce(start(), { type: "submit", now: T0 + 5_000 });
    if (state.phase !== "results") throw new Error();
    const json = JSON.stringify(toGameResult(state.round, NOW));
    for (const cell of state.round.challenge.cells.values()) {
      if (cell.editable && cell.solution.startsWith("=")) expect(json).not.toContain(cell.solution);
    }
    for (const doc of state.round.challenge.documents) expect(json).not.toContain(doc.number);
    expect(Object.keys(JSON.parse(json))).not.toContain("challenge");
  });

  it("abandoned rounds never reach a result", () => {
    const abandoned = reduce(start(), { type: "openLobby" });
    expect(abandoned.phase).toBe("lobby");
    expect("round" in abandoned).toBe(false);
  });

  it("each started round carries its own session id", () => {
    expect(start("first").round.sessionId).toBe("first");
    expect(start("second").round.sessionId).toBe("second");
  });
});
