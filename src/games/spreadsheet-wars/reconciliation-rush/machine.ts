/**
 * Spreadsheet Wars state machine (pure).
 *
 *   lobby ─▶ briefing ─▶ playing ─▶ results ⇄ review
 *                           │ requestHint (once per round; the clock keeps running)
 *     ▲  ╲                  │ submit → outcome "completed"
 *     │   practice          │ time up → outcome "timedOut"
 *     └─────────────────────┘ (back to lobby / play again)
 *
 * "Completed" and "Timed Out" are the two outcomes of a finished round; both
 * land on the results screen (the Task Performance Report).
 *
 * Time is always passed in as `now` (a monotonic clock such as
 * performance.now()), never read here. Remaining time is derived from the
 * start timestamp, so throttled timers in background tabs cannot stretch a
 * round, and expiry is enforced on every action, not just on timer ticks.
 */
import { normalizeContent } from "../formula";
import { cellKey, type CellAddress } from "../sheet";
import { generateChallenge } from "./generate";
import { HINTS_PER_ROUND, createHint, type RoundHint } from "./hints";
import { gradeRound, type PerformanceGrade } from "./report";
import { scoreRound, type ScoreBreakdown } from "./scoring";
import type { Challenge } from "./types";
import { evaluateRound, type PlayerEntries, type RoundEvaluation } from "./validate";

export const ROUND_DURATION_MS = 90_000;

export type RoundOutcome = "completed" | "timedOut";

export interface ActiveRound {
  challenge: Challenge;
  startedAt: number;
  durationMs: number;
  entries: PlayerEntries;
  /** Assistance requested this round (at most HINTS_PER_ROUND). */
  hint: RoundHint | null;
}

export interface FinishedRound extends ActiveRound {
  /** Recorded for the report. Assistance currently has no score or XP effect. */
  assistanceUsed: boolean;
  outcome: RoundOutcome;
  elapsedMs: number;
  remainingMs: number;
  evaluation: RoundEvaluation;
  score: ScoreBreakdown;
  grade: PerformanceGrade;
}

export type SpreadsheetWarsState =
  | { phase: "lobby" }
  | { phase: "practice" }
  | { phase: "briefing"; challenge: Challenge }
  | { phase: "playing"; round: ActiveRound }
  | { phase: "results"; round: FinishedRound }
  | { phase: "review"; round: FinishedRound };

export type SpreadsheetWarsAction =
  | { type: "openLobby" }
  | { type: "openPractice" }
  | { type: "openBriefing"; seed: string }
  | { type: "start"; now: number }
  | { type: "commitCell"; address: CellAddress; content: string; now: number }
  | { type: "tick"; now: number }
  | { type: "submit"; now: number }
  | { type: "requestHint"; now: number }
  | { type: "openReview" }
  | { type: "closeReview" };

export const initialSpreadsheetWarsState: SpreadsheetWarsState = { phase: "lobby" };

export function remainingMs(round: ActiveRound, now: number): number {
  return Math.min(Math.max(round.durationMs - (now - round.startedAt), 0), round.durationMs);
}

export function isExpired(round: ActiveRound, now: number): boolean {
  return remainingMs(round, now) === 0;
}

export function hintsRemaining(round: ActiveRound): number {
  return round.hint ? HINTS_PER_ROUND - 1 : HINTS_PER_ROUND;
}

export function finishRound(round: ActiveRound, now: number, requested: RoundOutcome): FinishedRound {
  // A submission that arrives after the deadline is a timeout, not a completion.
  const outcome: RoundOutcome = isExpired(round, now) ? "timedOut" : requested;
  const remaining = outcome === "timedOut" ? 0 : remainingMs(round, now);
  const evaluation = evaluateRound(round.challenge, round.entries);
  return {
    ...round,
    outcome,
    elapsedMs: round.durationMs - remaining,
    remainingMs: remaining,
    assistanceUsed: round.hint !== null,
    evaluation,
    score: scoreRound(evaluation, remaining, round.durationMs),
    grade: gradeRound(evaluation),
  };
}

function commit(round: ActiveRound, address: CellAddress, content: string): ActiveRound {
  const key = cellKey(address);
  const cell = round.challenge.cells.get(key);
  if (!cell?.editable) return round;

  const entries = { ...round.entries };
  // Restoring the original content removes the edit entirely.
  if (normalizeContent(content) === normalizeContent(cell.initial)) delete entries[key];
  else entries[key] = content.trim();
  return { ...round, entries };
}

export function spreadsheetWarsReducer(state: SpreadsheetWarsState, action: SpreadsheetWarsAction): SpreadsheetWarsState {
  switch (action.type) {
    case "openLobby":
      // Leaving an active round is only possible through deliberate abandonment (UI confirms first).
      return { phase: "lobby" };
    case "openPractice":
      return state.phase === "lobby" ? { phase: "practice" } : state;
    case "openBriefing":
      if (state.phase === "playing") return state;
      return { phase: "briefing", challenge: generateChallenge(action.seed) };
    case "start":
      if (state.phase !== "briefing") return state;
      return {
        phase: "playing",
        round: { challenge: state.challenge, startedAt: action.now, durationMs: ROUND_DURATION_MS, entries: {}, hint: null },
      };
    case "commitCell":
      if (state.phase !== "playing") return state;
      if (isExpired(state.round, action.now)) return { phase: "results", round: finishRound(state.round, action.now, "timedOut") };
      return { phase: "playing", round: commit(state.round, action.address, action.content) };
    case "requestHint": {
      if (state.phase !== "playing") return state;
      if (isExpired(state.round, action.now)) return { phase: "results", round: finishRound(state.round, action.now, "timedOut") };
      if (hintsRemaining(state.round) === 0) return state;
      // The target is chosen from the sheet as it is now, so resolved errors are never hinted.
      const hint = createHint(state.round.challenge, state.round.entries, action.now - state.round.startedAt);
      return { phase: "playing", round: { ...state.round, hint } };
    }
    case "tick":
      if (state.phase !== "playing" || !isExpired(state.round, action.now)) return state;
      return { phase: "results", round: finishRound(state.round, action.now, "timedOut") };
    case "submit":
      // Ignored outside "playing", which makes double submission harmless.
      if (state.phase !== "playing") return state;
      return { phase: "results", round: finishRound(state.round, action.now, "completed") };
    case "openReview":
      return state.phase === "results" ? { phase: "review", round: state.round } : state;
    case "closeReview":
      return state.phase === "review" ? { phase: "results", round: state.round } : state;
  }
}
