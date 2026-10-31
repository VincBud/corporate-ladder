/**
 * Spreadsheet Wars state machine (pure).
 *
 *   lobby ─▶ briefing ─▶ playing ─▶ results ⇄ review
 *                           │ requestHint (once per round; the clock keeps running)
 *     ▲  ╲                  │ submit → outcome "completed"
 *     │   practice          │ time up → outcome "timedOut"
 *     └─────────────────────┘ (back to lobby / play again)
 *
 * Two kinds of round share this flow:
 * - "local" (guest practice): the browser has the full challenge and scores
 *   the round itself. Results stay in this browser.
 * - "verified" (signed-in players): the browser only has the public puzzle.
 *   Submitting (or running out of time) moves to "submitting"; the server
 *   rebuilds the round from its secret seed, scores it and sends back the
 *   finished round. The browser never decides a verified score.
 *
 * Time is always passed in as `now` (a monotonic clock such as
 * performance.now()), never read here. Remaining time is derived from the
 * start timestamp, so throttled timers in background tabs cannot stretch a
 * round. For verified rounds this local clock is display only; the server
 * enforces the deadline with its own timestamps.
 */
import { normalizeContent } from "../formula";
import { cellKey, type CellAddress } from "../sheet";
import { generateChallenge } from "./generate";
import { HINTS_PER_ROUND, createHint, type RoundHint } from "./hints";
import type { PublicChallenge } from "./public";
import { gradeRound, type PerformanceGrade } from "./report";
import { scoreRound, type ScoreBreakdown } from "./scoring";
import type { Challenge } from "./types";
import { evaluateRound, type PlayerEntries, type RoundEvaluation } from "./validate";

export const ROUND_DURATION_MS = 90_000;

export type RoundOutcome = "completed" | "timedOut";
export type RoundMode = "local" | "verified";

interface RoundCore {
  /** Unique per played round; results are recorded exactly once per session. */
  sessionId: string;
  startedAt: number;
  durationMs: number;
  entries: PlayerEntries;
  /** Assistance requested this round (at most HINTS_PER_ROUND). */
  hint: RoundHint | null;
}

export interface LocalActiveRound extends RoundCore {
  mode: "local";
  challenge: Challenge;
}

export interface VerifiedActiveRound extends RoundCore {
  mode: "verified";
  /** Public puzzle only: no solutions, planted errors or seed. */
  challenge: PublicChallenge;
}

export type ActiveRound = LocalActiveRound | VerifiedActiveRound;

export interface FinishedRound extends RoundCore {
  mode: RoundMode;
  /** Full challenge, available once the round is over (for review). */
  challenge: Challenge;
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
  | { phase: "briefing"; mode: "local"; challenge: Challenge }
  | { phase: "briefing"; mode: "verified"; starting: boolean; error: string | null }
  | { phase: "playing"; round: ActiveRound }
  | { phase: "submitting"; round: VerifiedActiveRound; outcome: RoundOutcome; error: string | null }
  | { phase: "results"; round: FinishedRound }
  | { phase: "review"; round: FinishedRound };

export type SpreadsheetWarsAction =
  | { type: "openLobby" }
  | { type: "openPractice" }
  | { type: "openBriefing"; seed: string }
  | { type: "openVerifiedBriefing" }
  | { type: "start"; now: number; sessionId: string }
  | { type: "verifiedStartRequested" }
  | { type: "verifiedStartFailed"; message: string }
  | { type: "verifiedRoundStarted"; round: VerifiedActiveRound }
  | { type: "commitCell"; address: CellAddress; content: string; now: number }
  | { type: "tick"; now: number }
  | { type: "submit"; now: number }
  | { type: "requestHint"; now: number }
  | { type: "hintReceived"; sessionId: string; hint: RoundHint }
  | { type: "verifiedSubmitFailed"; sessionId: string; message: string }
  | { type: "verifiedSubmitRetry" }
  | { type: "verifiedResultReceived"; round: FinishedRound }
  | { type: "openReview" }
  | { type: "closeReview" };

export const initialSpreadsheetWarsState: SpreadsheetWarsState = { phase: "lobby" };

export function remainingMs(round: Pick<RoundCore, "startedAt" | "durationMs">, now: number): number {
  return Math.min(Math.max(round.durationMs - (now - round.startedAt), 0), round.durationMs);
}

export function isExpired(round: Pick<RoundCore, "startedAt" | "durationMs">, now: number): boolean {
  return remainingMs(round, now) === 0;
}

export function hintsRemaining(round: Pick<RoundCore, "hint">): number {
  return round.hint ? HINTS_PER_ROUND - 1 : HINTS_PER_ROUND;
}

/** Scores a local round in the browser. Verified rounds are scored by the server instead. */
export function finishRound(round: LocalActiveRound, now: number, requested: RoundOutcome): FinishedRound {
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

/** Ends a round: local rounds are scored here, verified rounds go to the server. */
function endRound(round: ActiveRound, now: number, requested: RoundOutcome): SpreadsheetWarsState {
  if (round.mode === "local") return { phase: "results", round: finishRound(round, now, requested) };
  const outcome: RoundOutcome = isExpired(round, now) ? "timedOut" : requested;
  return { phase: "submitting", round, outcome, error: null };
}

function commit<R extends ActiveRound>(round: R, address: CellAddress, content: string): R {
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
      if (state.phase === "playing" || state.phase === "submitting") return state;
      return { phase: "briefing", mode: "local", challenge: generateChallenge(action.seed) };
    case "openVerifiedBriefing":
      if (state.phase === "playing" || state.phase === "submitting") return state;
      return { phase: "briefing", mode: "verified", starting: false, error: null };
    case "start":
      if (state.phase !== "briefing" || state.mode !== "local") return state;
      return {
        phase: "playing",
        round: {
          mode: "local",
          sessionId: action.sessionId,
          challenge: state.challenge,
          startedAt: action.now,
          durationMs: ROUND_DURATION_MS,
          entries: {},
          hint: null,
        },
      };
    case "verifiedStartRequested":
      if (state.phase !== "briefing" || state.mode !== "verified" || state.starting) return state;
      return { ...state, starting: true, error: null };
    case "verifiedStartFailed":
      if (state.phase !== "briefing" || state.mode !== "verified") return state;
      return { ...state, starting: false, error: action.message };
    case "verifiedRoundStarted":
      if (state.phase !== "briefing" || state.mode !== "verified" || !state.starting) return state;
      return { phase: "playing", round: action.round };
    case "commitCell":
      if (state.phase !== "playing") return state;
      if (isExpired(state.round, action.now)) return endRound(state.round, action.now, "timedOut");
      return { phase: "playing", round: commit(state.round, action.address, action.content) };
    case "requestHint": {
      // Local rounds only; verified hints come from the server (hintReceived).
      if (state.phase !== "playing" || state.round.mode !== "local") return state;
      if (isExpired(state.round, action.now)) return endRound(state.round, action.now, "timedOut");
      if (hintsRemaining(state.round) === 0) return state;
      // The target is chosen from the sheet as it is now, so resolved errors are never hinted.
      const hint = createHint(state.round.challenge, state.round.entries, action.now - state.round.startedAt);
      return { phase: "playing", round: { ...state.round, hint } };
    }
    case "hintReceived":
      if (state.phase !== "playing" || state.round.mode !== "verified") return state;
      if (state.round.sessionId !== action.sessionId || state.round.hint) return state;
      return { phase: "playing", round: { ...state.round, hint: action.hint } };
    case "tick":
      if (state.phase !== "playing" || !isExpired(state.round, action.now)) return state;
      return endRound(state.round, action.now, "timedOut");
    case "submit":
      // Ignored outside "playing", which makes double submission harmless.
      if (state.phase !== "playing") return state;
      return endRound(state.round, action.now, "completed");
    case "verifiedSubmitFailed":
      if (state.phase !== "submitting" || state.round.sessionId !== action.sessionId) return state;
      return { ...state, error: action.message };
    case "verifiedSubmitRetry":
      return state.phase === "submitting" ? { ...state, error: null } : state;
    case "verifiedResultReceived":
      if (state.phase !== "submitting" || state.round.sessionId !== action.round.sessionId) return state;
      return { phase: "results", round: action.round };
    case "openReview":
      return state.phase === "results" ? { phase: "review", round: state.round } : state;
    case "closeReview":
      return state.phase === "review" ? { phase: "results", round: state.round } : state;
  }
}
