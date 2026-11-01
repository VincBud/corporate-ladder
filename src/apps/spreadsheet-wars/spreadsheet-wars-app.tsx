"use client";

import { useEffect, useEffectEvent, useReducer, useState } from "react";
import { useAuth } from "@/auth/use-auth";
import { createSeed } from "@/games/spreadsheet-wars/reconciliation-rush/generate";
import {
  initialSpreadsheetWarsState,
  spreadsheetWarsReducer,
  type SpreadsheetWarsAction,
} from "@/games/spreadsheet-wars/reconciliation-rush/machine";
import { toGameResult } from "@/games/spreadsheet-wars/reconciliation-rush/result";
import { createSessionId } from "@/lib/session-id";
import { GUEST_SCOPE } from "@/performance/career-scope";
import { getCareerStore, useActiveCareerScope } from "@/performance/use-career";
import { api } from "@/services/api-client";
import { notifyCompanyChanged } from "@/services/company-source";
import { enqueueAchievementToasts } from "@/achievements/toast-queue";
import { onLaunchIntent, takeLaunchIntent } from "@/desktop/launch-intent";
import type { AppProps } from "../types";
import { SpreadsheetWarsLobby } from "./lobby";
import { Briefing } from "./rush/briefing";
import { TaskPerformanceReport } from "./rush/report";
import { MistakeReview } from "./rush/review";
import { RoundScreen } from "./rush/round-screen";
import { Submitting } from "./rush/submitting";
import { toFinishedRound, toVerifiedRound } from "./rush/verified";
import { SpreadsheetWorkspace } from "./workspace";

const ABANDON_WARNING =
  "A Reconciliation Rush round is in progress. Closing the window abandons it and nothing will be scored.";
const SUBMITTING_WARNING = "Your round is being verified. Closing now may hide the result until you reopen Corporate Career.";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong.");

export function SpreadsheetWarsApp({ setCloseWarning, openApp }: AppProps) {
  const [state, dispatch] = useReducer(spreadsheetWarsReducer, initialSpreadsheetWarsState);
  // Distinguishes user navigation from the first render, so focus only moves
  // when the player switches screens (not when the window first opens).
  const [navigated, setNavigated] = useState(false);
  // Session id of the last verified round the server recorded as a company contribution.
  const [contributionFor, setContributionFor] = useState<string | null>(null);
  const auth = useAuth();
  const scope = useActiveCareerScope();
  const playing = state.phase === "playing";
  const busy = playing || state.phase === "submitting";

  const act = (action: SpreadsheetWarsAction) => {
    setNavigated(true);
    dispatch(action);
  };

  // Signed-in players play verified rounds; guests play local practice.
  const verifiedPlay = auth.status === "signedIn";
  const newRound = () => act(verifiedPlay ? { type: "openVerifiedBriefing" } : { type: "openBriefing", seed: createSeed() });

  // "Play your first assignment" (orientation): open the briefing, never a running round.
  const openBriefingFromIntent = useEffectEvent(() => {
    takeLaunchIntent("spreadsheet-wars");
    if (state.phase !== "playing" && state.phase !== "submitting") newRound();
  });
  const authKnown = auth.status !== "loading";
  useEffect(() => {
    // Wait until guest vs. verified is known; the intent stays pending until then.
    if (!authKnown) return;
    return onLaunchIntent("spreadsheet-wars", () => openBriefingFromIntent());
  }, [authKnown]);

  async function startVerifiedRound() {
    act({ type: "verifiedStartRequested" });
    try {
      const response = await api.startRound();
      dispatch({ type: "verifiedRoundStarted", round: toVerifiedRound(response, performance.now()) });
    } catch (error) {
      dispatch({ type: "verifiedStartFailed", message: messageOf(error) });
    }
  }

  // Guest rounds: record the finalized round in this browser's history.
  // Recording is keyed by session id, so re-renders, the review screen or
  // reopening the report never add a second record. Abandoned rounds never get here.
  const finishedRound = state.phase === "results" || state.phase === "review" ? state.round : null;
  useEffect(() => {
    if (finishedRound?.mode === "local") {
      void getCareerStore(GUEST_SCOPE).recordResult(finishedRound.sessionId, toGameResult(finishedRound, new Date()));
    }
  }, [finishedRound]);

  // Verified rounds: send the committed cells; the server scores and records.
  // Safe to repeat (StrictMode, retries): the server finalizes each session once.
  const submitting = state.phase === "submitting" && state.error === null ? state : null;
  useEffect(() => {
    if (!submitting) return;
    const { round } = submitting;
    let cancelled = false;
    api.submitRound(round.sessionId, round.entries).then(
      (response) => {
        if (cancelled) return;
        if (scope && scope !== GUEST_SCOPE) {
          getCareerStore(scope).applyVerifiedResult(round.sessionId, response);
          if (response.achievements?.length) {
            enqueueAchievementToasts(response.achievements);
            void getCareerStore(scope).load();
          }
        }
        if (response.contribution?.recorded) {
          setContributionFor(round.sessionId);
          notifyCompanyChanged();
        }
        dispatch({ type: "verifiedResultReceived", round: toFinishedRound(round.sessionId, response) });
      },
      (error) => {
        if (!cancelled) dispatch({ type: "verifiedSubmitFailed", sessionId: round.sessionId, message: messageOf(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [submitting, scope]);

  // Ask before the window (or the browser tab) closes mid-round.
  useEffect(() => {
    setCloseWarning(playing ? ABANDON_WARNING : state.phase === "submitting" ? SUBMITTING_WARNING : null);
    return () => setCloseWarning(null);
  }, [playing, state.phase, setCloseWarning]);

  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  switch (state.phase) {
    case "lobby":
      return (
        <SpreadsheetWarsLobby
          focusOnMount={navigated}
          playMode={auth.status === "loading" ? "loading" : verifiedPlay ? "verified" : "guest"}
          onPlayReconciliationRush={newRound}
          onOpenWorkspace={() => act({ type: "openPractice" })}
        />
      );
    case "practice":
      return <SpreadsheetWorkspace focusOnMount={navigated} onBackToLobby={() => act({ type: "openLobby" })} />;
    case "briefing":
      return state.mode === "local" ? (
        <Briefing
          challenge={state.challenge}
          mode="local"
          onStart={() => act({ type: "start", now: performance.now(), sessionId: createSessionId() })}
          onBack={() => act({ type: "openLobby" })}
        />
      ) : (
        <Briefing
          challenge={null}
          mode="verified"
          starting={state.starting}
          error={state.error}
          onStart={() => void startVerifiedRound()}
          onBack={() => act({ type: "openLobby" })}
        />
      );
    case "playing": {
      const { round } = state;
      return (
        <RoundScreen
          key={round.sessionId}
          round={round}
          dispatch={act}
          onRequestVerifiedHint={
            round.mode === "verified"
              ? async () => {
                  const { hint } = await api.requestHint(round.sessionId, round.entries);
                  dispatch({ type: "hintReceived", sessionId: round.sessionId, hint });
                }
              : undefined
          }
        />
      );
    }
    case "submitting":
      return (
        <Submitting
          error={state.error}
          onRetry={() => act({ type: "verifiedSubmitRetry" })}
          onLobby={() => act({ type: "openLobby" })}
        />
      );
    case "results":
      return (
        <TaskPerformanceReport
          round={state.round}
          onPlayAgain={newRound}
          onReview={() => act({ type: "openReview" })}
          onLobby={() => act({ type: "openLobby" })}
          companyContribution={state.round.mode === "verified" && contributionFor === state.round.sessionId}
          onOpenCompany={() => openApp("company")}
        />
      );
    case "review":
      return (
        <MistakeReview round={state.round} onBack={() => act({ type: "closeReview" })} onPlayAgain={newRound} />
      );
  }
}
