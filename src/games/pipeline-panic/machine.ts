/**
 * Pipeline Panic round flow:
 *
 *   lobby → briefing → playing → (submitting, verified only) → results ⇄ review
 *
 * Local rounds (guests) are generated and scored in the browser. Verified
 * rounds start on the server; the client only keeps decisions and sends
 * them on submit, and the server's result replaces anything local.
 */
import type { PipelineHint } from "./hints";
import { toPublicPipelineRound } from "./public";
import { buildPipelineReview, type FinishedPipelineReview } from "./review";
import type { PipelineDecision, PipelineRound, PublicPipelineRound } from "./types";

export const PIPELINE_ROUND_DURATION_MS = 90_000;

export type PipelineOutcome = "completed" | "timedOut";

export interface ActivePipelineRound {
  mode: "local" | "verified";
  sessionId: string;
  round: PublicPipelineRound;
  /** Local rounds only: the full round, needed to score in the browser. */
  full: PipelineRound | null;
  /** performance.now() when the round started (client clock, display only for verified rounds). */
  startedAt: number;
  durationMs: number;
  decisions: Readonly<Record<string, PipelineDecision>>;
  selectedId: string;
  hint: PipelineHint | null;
}

export interface FinishedPipelineRound extends FinishedPipelineReview {
  mode: "local" | "verified";
  sessionId: string;
  /** Local (guest) rounds only, for the browser's history. Never sent by the server. */
  localSeed: string | null;
}

export type PipelineState =
  | { phase: "lobby" }
  | { phase: "briefing"; mode: "local"; round: PipelineRound }
  | { phase: "briefing"; mode: "verified"; starting: boolean; error: string | null }
  | { phase: "playing"; active: ActivePipelineRound }
  | { phase: "submitting"; active: ActivePipelineRound; outcome: PipelineOutcome; elapsedMs: number; error: string | null }
  | { phase: "results"; finished: FinishedPipelineRound }
  | { phase: "review"; finished: FinishedPipelineRound };

export type PipelineMachineAction =
  | { type: "openLobby" }
  /** Leaves an active round on purpose (the UI confirms first). Nothing is scored. */
  | { type: "abandon" }
  | { type: "openBriefing"; round: PipelineRound }
  | { type: "openVerifiedBriefing" }
  | { type: "verifiedStartRequested" }
  | { type: "verifiedStartFailed"; message: string }
  | { type: "start"; now: number; sessionId: string }
  | { type: "verifiedRoundStarted"; active: ActivePipelineRound }
  | { type: "select"; id: string }
  | { type: "decide"; id: string; decision: PipelineDecision | null }
  | { type: "hintReceived"; sessionId: string; hint: PipelineHint }
  | { type: "finish"; now: number; outcome: PipelineOutcome }
  | { type: "verifiedSubmitFailed"; sessionId: string; message: string }
  | { type: "verifiedSubmitRetry" }
  | { type: "verifiedResultReceived"; finished: FinishedPipelineRound }
  | { type: "openReview" }
  | { type: "closeReview" };

export const initialPipelineState: PipelineState = { phase: "lobby" };

export function remainingMs(active: Pick<ActivePipelineRound, "startedAt" | "durationMs">, now: number): number {
  return Math.max(0, active.durationMs - (now - active.startedAt));
}

/** Scores a finished local round in the browser and keeps only the client-safe review. */
export function finishLocalRound(active: ActivePipelineRound, outcome: PipelineOutcome, elapsedMs: number): FinishedPipelineRound {
  const round = active.full!;
  const remaining = outcome === "completed" ? Math.max(0, active.durationMs - elapsedMs) : 0;
  return {
    mode: "local",
    sessionId: active.sessionId,
    localSeed: round.seed,
    ...buildPipelineReview({ round, decisions: active.decisions, remainingMs: remaining, durationMs: active.durationMs, hint: active.hint }),
    decisions: { ...active.decisions },
    outcome,
    elapsedMs: Math.min(elapsedMs, active.durationMs),
    remainingMs: remaining,
    durationMs: active.durationMs,
    assistanceUsed: active.hint !== null,
  };
}

export function pipelineReducer(state: PipelineState, action: PipelineMachineAction): PipelineState {
  switch (action.type) {
    case "openLobby":
      return state.phase === "playing" ? state : { phase: "lobby" };
    case "abandon":
      return state.phase === "playing" ? { phase: "lobby" } : state;
    case "openBriefing":
      return { phase: "briefing", mode: "local", round: action.round };
    case "openVerifiedBriefing":
      return { phase: "briefing", mode: "verified", starting: false, error: null };
    case "verifiedStartRequested":
      return state.phase === "briefing" && state.mode === "verified" ? { ...state, starting: true, error: null } : state;
    case "verifiedStartFailed":
      return state.phase === "briefing" && state.mode === "verified" ? { ...state, starting: false, error: action.message } : state;
    case "start": {
      if (state.phase !== "briefing" || state.mode !== "local") return state;
      const round = state.round;
      return {
        phase: "playing",
        active: {
          mode: "local",
          sessionId: action.sessionId,
          round: toPublicPipelineRound(round),
          full: round,
          startedAt: action.now,
          durationMs: PIPELINE_ROUND_DURATION_MS,
          decisions: {},
          selectedId: round.opportunities[0].id,
          hint: null,
        },
      };
    }
    case "verifiedRoundStarted":
      return state.phase === "briefing" && state.mode === "verified" ? { phase: "playing", active: action.active } : state;
    case "select":
      if (state.phase !== "playing" || !state.active.round.opportunities.some((o) => o.id === action.id)) return state;
      return { phase: "playing", active: { ...state.active, selectedId: action.id } };
    case "decide": {
      if (state.phase !== "playing" || !state.active.round.opportunities.some((o) => o.id === action.id)) return state;
      const decisions = { ...state.active.decisions };
      if (action.decision) decisions[action.id] = action.decision;
      else delete decisions[action.id];
      return { phase: "playing", active: { ...state.active, decisions } };
    }
    case "hintReceived":
      if (state.phase !== "playing" || state.active.sessionId !== action.sessionId || state.active.hint) return state;
      return { phase: "playing", active: { ...state.active, hint: action.hint } };
    case "finish": {
      if (state.phase !== "playing") return state;
      const elapsedMs = Math.min(action.now - state.active.startedAt, state.active.durationMs);
      if (state.active.mode === "local") return { phase: "results", finished: finishLocalRound(state.active, action.outcome, elapsedMs) };
      return { phase: "submitting", active: state.active, outcome: action.outcome, elapsedMs, error: null };
    }
    case "verifiedSubmitFailed":
      return state.phase === "submitting" && state.active.sessionId === action.sessionId ? { ...state, error: action.message } : state;
    case "verifiedSubmitRetry":
      return state.phase === "submitting" ? { ...state, error: null } : state;
    case "verifiedResultReceived":
      return { phase: "results", finished: action.finished };
    case "openReview":
      return state.phase === "results" ? { phase: "review", finished: state.finished } : state;
    case "closeReview":
      return state.phase === "review" ? { phase: "results", finished: state.finished } : state;
  }
}
