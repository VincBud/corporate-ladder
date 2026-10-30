"use client";

import { useEffect, useReducer, useState } from "react";
import { createSeed } from "@/games/spreadsheet-wars/reconciliation-rush/generate";
import {
  initialSpreadsheetWarsState,
  spreadsheetWarsReducer,
  type SpreadsheetWarsAction,
} from "@/games/spreadsheet-wars/reconciliation-rush/machine";
import type { AppProps } from "../types";
import { SpreadsheetWarsLobby } from "./lobby";
import { Briefing } from "./rush/briefing";
import { TaskPerformanceReport } from "./rush/report";
import { MistakeReview } from "./rush/review";
import { RoundScreen } from "./rush/round-screen";
import { SpreadsheetWorkspace } from "./workspace";

const ABANDON_WARNING =
  "A Reconciliation Rush round is in progress. Closing the window abandons it and nothing will be scored.";

export function SpreadsheetWarsApp({ setCloseWarning }: AppProps) {
  const [state, dispatch] = useReducer(spreadsheetWarsReducer, initialSpreadsheetWarsState);
  // Distinguishes user navigation from the first render, so focus only moves
  // when the player switches screens (not when the window first opens).
  const [navigated, setNavigated] = useState(false);
  const playing = state.phase === "playing";

  const act = (action: SpreadsheetWarsAction) => {
    setNavigated(true);
    dispatch(action);
  };
  const newRound = () => act({ type: "openBriefing", seed: createSeed() });

  // Ask before the window (or the browser tab) closes mid-round.
  useEffect(() => {
    setCloseWarning(playing ? ABANDON_WARNING : null);
    return () => setCloseWarning(null);
  }, [playing, setCloseWarning]);

  useEffect(() => {
    if (!playing) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [playing]);

  switch (state.phase) {
    case "lobby":
      return (
        <SpreadsheetWarsLobby
          focusOnMount={navigated}
          onPlayReconciliationRush={newRound}
          onOpenWorkspace={() => act({ type: "openPractice" })}
        />
      );
    case "practice":
      return <SpreadsheetWorkspace focusOnMount={navigated} onBackToLobby={() => act({ type: "openLobby" })} />;
    case "briefing":
      return (
        <Briefing
          challenge={state.challenge}
          onStart={() => act({ type: "start", now: performance.now() })}
          onBack={() => act({ type: "openLobby" })}
        />
      );
    case "playing":
      return <RoundScreen key={state.round.startedAt} round={state.round} dispatch={act} />;
    case "results":
      return (
        <TaskPerformanceReport
          round={state.round}
          onPlayAgain={newRound}
          onReview={() => act({ type: "openReview" })}
          onLobby={() => act({ type: "openLobby" })}
        />
      );
    case "review":
      return (
        <MistakeReview round={state.round} onBack={() => act({ type: "closeReview" })} onPlayAgain={newRound} />
      );
  }
}
