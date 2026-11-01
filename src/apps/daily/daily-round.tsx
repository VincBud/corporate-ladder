"use client";

/**
 * Plays a ranked Daily Challenge round with the games' own round screens and
 * state machines. Differences from practice: the round comes from
 * /api/daily (start or resume), leaving keeps it running on the server, and
 * the result carries no review (answers stay sealed while others still play).
 */
import { useEffect, useReducer } from "react";
import type { PipelineHint } from "@/games/pipeline-panic/hints";
import { pipelineReducer, type ActivePipelineRound, type PipelineMachineAction, type PipelineState } from "@/games/pipeline-panic/machine";
import type { PipelineDecisions } from "@/games/pipeline-panic/types";
import type { RoundHint } from "@/games/spreadsheet-wars/reconciliation-rush/hints";
import { spreadsheetWarsReducer, type SpreadsheetWarsAction, type SpreadsheetWarsState, type VerifiedActiveRound } from "@/games/spreadsheet-wars/reconciliation-rush/machine";
import type { PlayerEntries } from "@/games/spreadsheet-wars/reconciliation-rush/validate";
import { api } from "@/services/api-client";
import type { DailyStartResponse } from "@/types/daily";
import type { SubmitPipelineResponse } from "@/types/pipeline-play";
import type { SubmitRoundResponse } from "@/types/verified-play";
import { toActive } from "../pipeline-panic/pipeline-panic-app";
import { PipelineRoundScreen } from "../pipeline-panic/round-screen";
import { PipelineSubmitting } from "../pipeline-panic/screens";
import { RoundScreen } from "../spreadsheet-wars/rush/round-screen";
import { Submitting } from "../spreadsheet-wars/rush/submitting";
import { toVerifiedRound } from "../spreadsheet-wars/rush/verified";

export type DailyPlay =
  | { gameId: "reconciliation-rush"; challengeId: string; assignmentId: string; round: VerifiedActiveRound }
  | { gameId: "pipeline-panic"; challengeId: string; assignmentId: string; active: ActivePipelineRound };

export type DailySubmitted = SubmitRoundResponse | SubmitPipelineResponse;

const EXIT_COPY = {
  title: "Leave your ranked attempt?",
  body: "The server clock keeps running. Reopen Daily Assignments to resume before the timer ends. Your attempt is used either way.",
  confirm: "Leave for now",
};

const messageOf = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong.");

// Per-viewer convenience: unsent answers survive a reload of this browser. Best effort only.
const draftKey = (sessionId: string) => `corporate-ladder:daily-draft:${sessionId}`;
function readDraft<T>(sessionId: string): T | null {
  try {
    const raw = window.localStorage.getItem(draftKey(sessionId));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function writeDraft(sessionId: string, value: unknown) {
  try {
    window.localStorage.setItem(draftKey(sessionId), JSON.stringify(value));
  } catch {
    // Storage unavailable: resuming still works, without the unsent answers.
  }
}
export function clearDraft(sessionId: string) {
  try {
    window.localStorage.removeItem(draftKey(sessionId));
  } catch {
    // Nothing to clear.
  }
}

/** Builds the playable round from a start/resume response. Call from an event handler. */
export function toDailyPlay(response: DailyStartResponse, receivedAt: number): DailyPlay {
  const base = { challengeId: response.challengeId, assignmentId: response.assignmentId };
  if (response.gameId === "reconciliation-rush") {
    const round = toVerifiedRound(response.round, receivedAt);
    return {
      ...base,
      gameId: "reconciliation-rush",
      round: { ...round, entries: readDraft<PlayerEntries>(round.sessionId) ?? {}, hint: (response.hint as RoundHint | null) ?? null },
    };
  }
  const active = toActive(response.round, receivedAt);
  return {
    ...base,
    gameId: "pipeline-panic",
    active: { ...active, decisions: readDraft<PipelineDecisions>(active.sessionId) ?? {}, hint: (response.hint as PipelineHint | null) ?? null },
  };
}

interface DailyRoundProps {
  play: DailyPlay;
  onSubmitted: (response: DailySubmitted) => void;
  /** Back to the overview; the round keeps running on the server. */
  onLeave: () => void;
}

export function DailyRound({ play, onSubmitted, onLeave }: DailyRoundProps) {
  return play.gameId === "reconciliation-rush" ? (
    <AuditRound round={play.round} onSubmitted={onSubmitted} onLeave={onLeave} />
  ) : (
    <SalesRound active={play.active} onSubmitted={onSubmitted} onLeave={onLeave} />
  );
}

function AuditRound({ round: initial, onSubmitted, onLeave }: { round: VerifiedActiveRound } & Omit<DailyRoundProps, "play">) {
  const [state, dispatch] = useReducer(spreadsheetWarsReducer, { phase: "playing", round: initial } satisfies SpreadsheetWarsState);
  const act = (action: SpreadsheetWarsAction) => (action.type === "openLobby" ? onLeave() : dispatch(action));

  const entries = state.phase === "playing" ? state.round.entries : null;
  useEffect(() => {
    if (entries) writeDraft(initial.sessionId, entries);
  }, [entries, initial.sessionId]);

  const submitting = state.phase === "submitting" && state.error === null ? state : null;
  useEffect(() => {
    if (!submitting) return;
    let cancelled = false;
    api.submitRound(submitting.round.sessionId, submitting.round.entries).then(
      (response) => {
        if (!cancelled) onSubmitted(response);
      },
      (error) => {
        if (!cancelled) dispatch({ type: "verifiedSubmitFailed", sessionId: submitting.round.sessionId, message: messageOf(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [submitting, onSubmitted]);

  if (state.phase === "playing") {
    const round = state.round;
    return (
      <RoundScreen
        key={round.sessionId}
        round={round}
        dispatch={act}
        exitCopy={EXIT_COPY}
        onRequestVerifiedHint={async () => {
          const { hint } = await api.requestHint(round.sessionId, round.entries);
          dispatch({ type: "hintReceived", sessionId: round.sessionId, hint });
        }}
      />
    );
  }
  if (state.phase === "submitting") {
    return <Submitting error={state.error} onRetry={() => dispatch({ type: "verifiedSubmitRetry" })} onLobby={onLeave} />;
  }
  return null;
}

function SalesRound({ active: initial, onSubmitted, onLeave }: { active: ActivePipelineRound } & Omit<DailyRoundProps, "play">) {
  const [state, dispatch] = useReducer(pipelineReducer, { phase: "playing", active: initial } satisfies PipelineState);
  const act = (action: PipelineMachineAction) => (action.type === "abandon" || action.type === "openLobby" ? onLeave() : dispatch(action));

  const decisions = state.phase === "playing" ? state.active.decisions : null;
  useEffect(() => {
    if (decisions) writeDraft(initial.sessionId, decisions);
  }, [decisions, initial.sessionId]);

  const submitting = state.phase === "submitting" && state.error === null ? state : null;
  useEffect(() => {
    if (!submitting) return;
    let cancelled = false;
    api.submitPipeline(submitting.active.sessionId, submitting.active.decisions).then(
      (response) => {
        if (!cancelled) onSubmitted(response);
      },
      (error) => {
        if (!cancelled) dispatch({ type: "verifiedSubmitFailed", sessionId: submitting.active.sessionId, message: messageOf(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [submitting, onSubmitted]);

  if (state.phase === "playing") {
    const active = state.active;
    return (
      <PipelineRoundScreen
        key={active.sessionId}
        active={active}
        dispatch={act}
        exitCopy={EXIT_COPY}
        onRequestHint={async () => {
          const { hint } = await api.requestPipelineHint(active.sessionId, active.decisions);
          dispatch({ type: "hintReceived", sessionId: active.sessionId, hint });
        }}
      />
    );
  }
  if (state.phase === "submitting") {
    return <PipelineSubmitting error={state.error} onRetry={() => dispatch({ type: "verifiedSubmitRetry" })} onLobby={onLeave} />;
  }
  return null;
}
