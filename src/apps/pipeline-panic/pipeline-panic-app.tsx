"use client";

import { useEffect, useReducer, useState } from "react";
import { useAuth } from "@/auth/use-auth";
import { createPipelineSeed, generatePipelineRound } from "@/games/pipeline-panic/generate";
import { createPipelineHint } from "@/games/pipeline-panic/hints";
import { initialPipelineState, pipelineReducer, type ActivePipelineRound, type FinishedPipelineRound, type PipelineMachineAction } from "@/games/pipeline-panic/machine";
import { toPipelineGameResult } from "@/games/pipeline-panic/result";
import { createSessionId } from "@/lib/session-id";
import { GUEST_SCOPE } from "@/performance/career-scope";
import { getCareerStore, useActiveCareerScope } from "@/performance/use-career";
import { api } from "@/services/api-client";
import { notifyCompanyChanged } from "@/services/company-source";
import { enqueueAchievementToasts } from "@/achievements/toast-queue";
import type { StartPipelineResponse, SubmitPipelineResponse } from "@/types/pipeline-play";
import type { AppProps } from "../types";
import { PipelineReport, PipelineReview } from "./report";
import { PipelineRoundScreen } from "./round-screen";
import { PipelineBriefing, PipelineLobby, PipelineSubmitting } from "./screens";

const ABANDON_WARNING = "A Pipeline Panic round is in progress. Closing the window abandons it and nothing will be scored.";
const SUBMITTING_WARNING = "Your round is being verified. Closing now may hide the result until you reopen Corporate Career.";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong.");

export function toActive(response: StartPipelineResponse, now: number): ActivePipelineRound {
  // The countdown follows server time: subtract the time that already passed on the server.
  const elapsed = Math.max(0, Date.parse(response.serverNow) - Date.parse(response.startedAt));
  return {
    mode: "verified",
    sessionId: response.sessionId,
    round: response.round,
    full: null,
    startedAt: now - elapsed,
    durationMs: response.durationMs,
    decisions: {},
    selectedId: response.round.opportunities[0].id,
    hint: null,
  };
}

function toFinished(sessionId: string, response: SubmitPipelineResponse): FinishedPipelineRound {
  const { review } = response;
  // Practice rounds always carry a review; only ranked daily rounds (played in Daily Assignments) don't.
  if (!review) throw new Error("This round's review is sealed.");
  return { mode: "verified", sessionId, localSeed: null, ...review };
}

export function PipelinePanicApp({ setCloseWarning, setInFlow, openApp }: AppProps) {
  const [state, dispatch] = useReducer(pipelineReducer, initialPipelineState);
  const [navigated, setNavigated] = useState(false);
  const [contributionFor, setContributionFor] = useState<string | null>(null);
  const auth = useAuth();
  const scope = useActiveCareerScope();
  const playing = state.phase === "playing";
  const busy = playing || state.phase === "submitting";
  const verifiedPlay = auth.status === "signedIn";

  const act = (action: PipelineMachineAction) => {
    setNavigated(true);
    dispatch(action);
  };
  const newRound = () => act(verifiedPlay ? { type: "openVerifiedBriefing" } : { type: "openBriefing", round: generatePipelineRound(createPipelineSeed()) });

  async function startVerified() {
    act({ type: "verifiedStartRequested" });
    try {
      const response = await api.startPipeline();
      dispatch({ type: "verifiedRoundStarted", active: toActive(response, performance.now()) });
    } catch (error) {
      dispatch({ type: "verifiedStartFailed", message: messageOf(error) });
    }
  }

  // Guest rounds: record once per session in this browser's history.
  const finished = state.phase === "results" || state.phase === "review" ? state.finished : null;
  useEffect(() => {
    if (finished?.mode === "local" && finished.localSeed) {
      void getCareerStore(GUEST_SCOPE).recordResult(finished.sessionId, toPipelineGameResult({ seed: finished.localSeed, review: finished }, new Date()));
    }
  }, [finished]);

  // Verified rounds: send decisions only; the server scores and records (safe to repeat).
  const submitting = state.phase === "submitting" && state.error === null ? state : null;
  useEffect(() => {
    if (!submitting) return;
    const { active } = submitting;
    let cancelled = false;
    api.submitPipeline(active.sessionId, active.decisions).then(
      (response) => {
        if (cancelled) return;
        if (scope && scope !== GUEST_SCOPE) {
          getCareerStore(scope).applyVerifiedResult(active.sessionId, response);
          if (response.achievements?.length) {
            enqueueAchievementToasts(response.achievements);
            void getCareerStore(scope).load();
          }
        }
        if (response.contribution.recorded) {
          setContributionFor(active.sessionId);
          notifyCompanyChanged();
        }
        dispatch({ type: "verifiedResultReceived", finished: toFinished(active.sessionId, response) });
      },
      (error) => {
        if (!cancelled) dispatch({ type: "verifiedSubmitFailed", sessionId: active.sessionId, message: messageOf(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [submitting, scope]);

  useEffect(() => {
    setCloseWarning(playing ? ABANDON_WARNING : state.phase === "submitting" ? SUBMITTING_WARNING : null);
    return () => setCloseWarning(null);
  }, [playing, state.phase, setCloseWarning]);

  // Game flow in progress: the desktop holds back prompts such as the survey.
  const inFlow = state.phase !== "lobby";
  useEffect(() => {
    setInFlow(inFlow);
    return () => setInFlow(false);
  }, [inFlow, setInFlow]);

  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  switch (state.phase) {
    case "lobby":
      return <PipelineLobby focusOnMount={navigated} playMode={auth.status === "loading" ? "loading" : verifiedPlay ? "verified" : "guest"} onPlay={newRound} />;
    case "briefing":
      return state.mode === "local" ? (
        <PipelineBriefing
          mode="local"
          playbook={state.round.playbook}
          opportunityCount={state.round.opportunities.length}
          onStart={() => act({ type: "start", now: performance.now(), sessionId: createSessionId() })}
          onBack={() => act({ type: "openLobby" })}
        />
      ) : (
        <PipelineBriefing
          mode="verified"
          playbook={null}
          opportunityCount={null}
          starting={state.starting}
          error={state.error}
          onStart={() => void startVerified()}
          onBack={() => act({ type: "openLobby" })}
        />
      );
    case "playing": {
      const { active } = state;
      return (
        <PipelineRoundScreen
          key={active.sessionId}
          active={active}
          dispatch={act}
          onRequestHint={async () => {
            if (active.mode === "verified") {
              const { hint } = await api.requestPipelineHint(active.sessionId, active.decisions);
              dispatch({ type: "hintReceived", sessionId: active.sessionId, hint });
            } else {
              dispatch({ type: "hintReceived", sessionId: active.sessionId, hint: createPipelineHint(active.full!, active.decisions, performance.now() - active.startedAt) });
            }
          }}
        />
      );
    }
    case "submitting":
      return <PipelineSubmitting error={state.error} onRetry={() => act({ type: "verifiedSubmitRetry" })} onLobby={() => act({ type: "openLobby" })} />;
    case "results":
      return (
        <PipelineReport
          finished={state.finished}
          companyContribution={state.finished.mode === "verified" && contributionFor === state.finished.sessionId}
          onRetryCareer={() => {
            if (state.finished.localSeed) {
              void getCareerStore(GUEST_SCOPE).recordResult(state.finished.sessionId, toPipelineGameResult({ seed: state.finished.localSeed, review: state.finished }, new Date()));
            }
          }}
          onReview={() => act({ type: "openReview" })}
          onPlayAgain={newRound}
          onLobby={() => act({ type: "openLobby" })}
          onOpenCompany={() => openApp("company")}
        />
      );
    case "review":
      return <PipelineReview finished={state.finished} onBack={() => act({ type: "closeReview" })} onPlayAgain={newRound} />;
  }
}
