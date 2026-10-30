import { describe, expect, it } from "vitest";
import { cellKey } from "../sheet";
import {
  ROUND_DURATION_MS,
  initialSpreadsheetWarsState,
  isExpired,
  remainingMs,
  spreadsheetWarsReducer as reduce,
  type SpreadsheetWarsState,
} from "./machine";

const T0 = 1_000;

function playing(): Extract<SpreadsheetWarsState, { phase: "playing" }> {
  const briefing = reduce(initialSpreadsheetWarsState, { type: "openBriefing", seed: "RR-MACHINE" });
  const state = reduce(briefing, { type: "start", now: T0 });
  if (state.phase !== "playing") throw new Error("expected playing");
  return state;
}

describe("Spreadsheet Wars state machine", () => {
  it("walks lobby → briefing → playing → results → review → results → lobby", () => {
    let state: SpreadsheetWarsState = initialSpreadsheetWarsState;
    state = reduce(state, { type: "openBriefing", seed: "RR-FLOW" });
    expect(state.phase).toBe("briefing");
    state = reduce(state, { type: "start", now: T0 });
    expect(state.phase).toBe("playing");
    state = reduce(state, { type: "submit", now: T0 + 10_000 });
    expect(state.phase).toBe("results");
    state = reduce(state, { type: "openReview" });
    expect(state.phase).toBe("review");
    state = reduce(state, { type: "closeReview" });
    expect(state.phase).toBe("results");
    state = reduce(state, { type: "openBriefing", seed: "RR-AGAIN" });
    expect(state.phase).toBe("briefing");
    state = reduce(state, { type: "openLobby" });
    expect(state.phase).toBe("lobby");
    expect(reduce(state, { type: "openPractice" }).phase).toBe("practice");
  });

  it("does not start the timer before Start", () => {
    const briefing = reduce(initialSpreadsheetWarsState, { type: "openBriefing", seed: "RR-WAIT" });
    expect(reduce(briefing, { type: "tick", now: 10_000_000 })).toBe(briefing);
    const started = reduce(briefing, { type: "start", now: 10_000_000 });
    expect(started.phase === "playing" && remainingMs(started.round, 10_000_000)).toBe(ROUND_DURATION_MS);
  });

  it("computes remaining time from the start timestamp", () => {
    const { round } = playing();
    expect(remainingMs(round, T0)).toBe(ROUND_DURATION_MS);
    expect(remainingMs(round, T0 + 30_000)).toBe(60_000);
    expect(remainingMs(round, T0 + ROUND_DURATION_MS - 1)).toBe(1);
    expect(isExpired(round, T0 + ROUND_DURATION_MS - 1)).toBe(false);
    expect(isExpired(round, T0 + ROUND_DURATION_MS)).toBe(true);
    expect(remainingMs(round, T0 + 10 * ROUND_DURATION_MS)).toBe(0);
    expect(remainingMs(round, T0 - 500)).toBe(ROUND_DURATION_MS);
  });

  it("times out on the first tick at or after the deadline", () => {
    const state = playing();
    expect(reduce(state, { type: "tick", now: T0 + ROUND_DURATION_MS - 1 })).toBe(state);
    const finished = reduce(state, { type: "tick", now: T0 + ROUND_DURATION_MS });
    expect(finished.phase).toBe("results");
    if (finished.phase !== "results") return;
    expect(finished.round.outcome).toBe("timedOut");
    expect(finished.round.remainingMs).toBe(0);
    expect(finished.round.elapsedMs).toBe(ROUND_DURATION_MS);
  });

  it("treats a late submission (e.g. after a backgrounded tab) as a timeout", () => {
    const finished = reduce(playing(), { type: "submit", now: T0 + 5 * ROUND_DURATION_MS });
    expect(finished.phase === "results" && finished.round.outcome).toBe("timedOut");
  });

  it("rejects edits after the deadline and finalizes instead", () => {
    const state = playing();
    const error = state.round.challenge.errors[0];
    const solution = state.round.challenge.cells.get(cellKey(error.address))!.solution;
    const late = reduce(state, { type: "commitCell", address: error.address, content: solution, now: T0 + ROUND_DURATION_MS });
    expect(late.phase).toBe("results");
    if (late.phase !== "results") return;
    expect(late.round.entries).toEqual({});
    expect(late.round.evaluation.fixedCount).toBe(0);
  });

  it("records edits, ignores read-only cells and drops edits restored to the original", () => {
    const state = playing();
    const error = state.round.challenge.errors[0];
    const key = cellKey(error.address);
    const cell = state.round.challenge.cells.get(key)!;

    let next = reduce(state, { type: "commitCell", address: error.address, content: "123", now: T0 + 1 });
    expect(next.phase === "playing" && next.round.entries[key]).toBe("123");
    next = reduce(next, { type: "commitCell", address: error.address, content: cell.initial, now: T0 + 2 });
    expect(next.phase === "playing" && key in next.round.entries).toBe(false);

    const readOnly = reduce(state, { type: "commitCell", address: { row: 0, col: 0 }, content: "hacked", now: T0 + 3 });
    expect(readOnly.phase === "playing" && readOnly.round.entries).toEqual({});
  });

  it("finalizes exactly once: repeated submits and ticks are ignored", () => {
    const state = playing();
    const first = reduce(state, { type: "submit", now: T0 + 20_000 });
    expect(first.phase === "results" && first.round.outcome).toBe("completed");
    expect(reduce(first, { type: "submit", now: T0 + 21_000 })).toBe(first);
    expect(reduce(first, { type: "tick", now: T0 + ROUND_DURATION_MS * 2 })).toBe(first);
    expect(reduce(first, { type: "commitCell", address: { row: 1, col: 3 }, content: "1", now: T0 + 22_000 })).toBe(first);
    expect(first.phase === "results" && first.round.remainingMs).toBe(70_000);
  });

  it("scores a perfect early submission with the time bonus", () => {
    const start = playing();
    const { challenge } = start.round;
    let state: SpreadsheetWarsState = start;
    for (const error of challenge.errors) {
      const solution = challenge.cells.get(cellKey(error.address))!.solution;
      state = reduce(state, { type: "commitCell", address: error.address, content: solution, now: T0 + 1_000 });
    }
    state = reduce(state, { type: "submit", now: T0 + 45_000 });
    expect(state.phase).toBe("results");
    if (state.phase !== "results") return;
    expect(state.round.evaluation.fixedCount).toBe(5);
    expect(state.round.score.timeBonus).toBe(150);
    expect(state.round.grade).toBe("Exceeds Expectations");
  });

  it("cannot open a briefing or practice while a round is in progress", () => {
    const state = playing();
    expect(reduce(state, { type: "openBriefing", seed: "RR-SNEAKY" })).toBe(state);
    expect(reduce(state, { type: "openPractice" })).toBe(state);
  });
});
