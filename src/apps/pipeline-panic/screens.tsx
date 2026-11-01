"use client";

import { useEffect, useRef } from "react";
import { FunnelIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import type { Playbook } from "@/games/pipeline-panic/types";
import { formatNumber } from "@/lib/format";
import { comparisonKey, personalBest } from "@/performance/stats";
import { useCareer } from "@/performance/use-career";
import { PIPELINE_PANIC_DIFFICULTY, PIPELINE_PANIC_GAME_ID, PIPELINE_PANIC_SCORING_VERSION } from "@/games/pipeline-panic/result";
import { ScreenWithActions } from "../spreadsheet-wars/rush/screen-layout";
import { playbookLines } from "./format";

const primary = "rounded-lg bg-emerald-600 px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-60";
const quiet = "rounded-lg px-3.5 py-2 text-[13px] font-medium text-fg-muted transition-colors hover:bg-white/6 hover:text-fg";

const BEST_KEY = comparisonKey({ gameId: PIPELINE_PANIC_GAME_ID, difficulty: PIPELINE_PANIC_DIFFICULTY, scoringVersion: PIPELINE_PANIC_SCORING_VERSION });

const RULES = [
  ["Qualify", "No confirmed budget or no decision maker? Disqualify."],
  ["Check the contract", "Restricted clauses or payment terms over the limit: disqualify."],
  ["Mind the calendar", "Closes after quarter end: keep it for next quarter."],
  ["Price it", "Budget ≥ list: close at list. Below list: the smallest discount that fits, if it's within your limit and keeps the margin floor. Otherwise disqualify."],
  ["Prioritize", "Only a few closing slots are left. Close the most valuable deals; the rest wait for next quarter."],
] as const;

export function PipelineLobby({ playMode, onPlay, focusOnMount }: { playMode: "verified" | "guest" | "loading"; onPlay: () => void; focusOnMount: boolean }) {
  const playRef = useRef<HTMLButtonElement>(null);
  const career = useCareer();
  const best = personalBest(career.records, BEST_KEY);

  useEffect(() => {
    if (focusOnMount) playRef.current?.focus({ preventScroll: true });
  }, [focusOnMount]);

  return (
    <div className="mx-auto max-w-4xl animate-view-in space-y-5 p-4 @xl:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-xl bg-linear-to-br from-amber-400 to-orange-700 text-white ring-1 ring-white/20 ring-inset">
            <FunnelIcon className="size-6" />
          </span>
          <div>
            <h3 className="text-xl font-semibold tracking-tight">Pipeline Panic</h3>
            <p className="text-xs text-fg-muted">Sales department · End-of-quarter pipeline triage in DealDesk CRM.</p>
          </div>
        </div>
        {playMode === "verified" ? (
          <Badge tone="success">Verified play · Cloud account</Badge>
        ) : playMode === "guest" ? (
          <Badge>Guest practice · This browser only</Badge>
        ) : (
          <Badge>Checking your badge…</Badge>
        )}
      </header>

      <section className="rounded-xl border border-line bg-linear-to-br from-surface-raised to-surface p-5">
        <p className="text-[11px] font-medium tracking-wider text-fg-subtle uppercase">Your mission</p>
        <p className="mt-1 text-sm">
          It&apos;s the last week of the quarter. Eight to ten opportunities need a decision in 90 seconds. Close the right deals at
          the right price, park the ones that aren&apos;t ready, and disqualify the ones that would get you a call from Legal.
        </p>
        <ol className="mt-4 grid gap-2 text-xs @xl:grid-cols-2">
          {RULES.map(([title, text], i) => (
            <li key={title} className="flex gap-2 rounded-lg bg-white/4 p-2.5 ring-1 ring-line ring-inset">
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-amber-400/15 text-[11px] font-semibold text-amber-300">{i + 1}</span>
              <span>
                <span className="font-medium text-fg">{title}.</span> <span className="text-fg-muted">{text}</span>
              </span>
            </li>
          ))}
        </ol>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button ref={playRef} type="button" onClick={onPlay} disabled={playMode === "loading"} className={primary}>
            Play Pipeline Panic
          </button>
          <p className="text-xs text-fg-muted">
            {best ? `Personal best ${formatNumber(best.score)} / ${formatNumber(best.maxScore)}` : "No rounds yet."}{" "}
            {playMode === "verified" ? "Rounds are scored by the server." : playMode === "guest" ? "Guest results stay in this browser." : ""}
          </p>
        </div>
      </section>
      <p className="text-[11px] text-fg-subtle">
        Verified rounds earn Corporate XP (1 per 20 points) and count toward Sales&apos; Pipeline health in the company. Scenarios are fictional.
      </p>
    </div>
  );
}

interface BriefingProps {
  playbook: Playbook | null;
  opportunityCount: number | null;
  mode: "local" | "verified";
  starting?: boolean;
  error?: string | null;
  onStart: () => void;
  onBack: () => void;
}

export function PipelineBriefing({ playbook, opportunityCount, mode, starting = false, error = null, onStart, onBack }: BriefingProps) {
  const startRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    startRef.current?.focus({ preventScroll: true });
  }, []);
  return (
    <ScreenWithActions
      actions={
        <>
          <button type="button" onClick={onBack} className={quiet}>
            Back
          </button>
          <button ref={startRef} type="button" onClick={onStart} disabled={starting} className={primary}>
            {starting ? "Opening the CRM…" : "Start the clock"}
          </button>
        </>
      }
    >
      <p className="text-[11px] font-medium tracking-[0.18em] text-fg-subtle uppercase">Quarter-end briefing</p>
      <h3 className="text-xl font-semibold">
        {opportunityCount ? `${opportunityCount} opportunities, 90 seconds` : "Your pipeline is waiting"}
      </h3>
      <p className="text-[13px] text-fg-muted">
        {mode === "verified"
          ? "The server deals the pipeline and keeps the clock. This round's playbook appears when it starts."
          : "Read the playbook. It changes every round."}{" "}
        One Request Assistance is available; it doesn&apos;t stop the clock.
      </p>
      {playbook && (
        <section aria-label="Sales playbook" className="rounded-xl border border-amber-400/30 bg-amber-400/8 p-4">
          <p className="mb-2 text-[11px] font-semibold tracking-wider text-amber-200 uppercase">This round&apos;s playbook</p>
          <dl className="grid gap-2 text-[13px] @lg:grid-cols-2">
            {playbookLines(playbook).map(([label, value]) => (
              <div key={label}>
                <dt className="text-[11px] text-fg-subtle">{label}</dt>
                <dd className="font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      <section className="rounded-xl border border-line bg-surface-raised/50 p-4 text-xs text-fg-muted">
        <p className="mb-1 font-medium text-fg">Controls</p>
        <p>
          Click an opportunity or use <kbd>J</kbd>/<kbd>K</kbd> (or ↑/↓). Decide with <kbd>1</kbd> close at list, <kbd>2</kbd> close with discount,{" "}
          <kbd>3</kbd> next quarter, <kbd>4</kbd> disqualify. <kbd>[</kbd>/<kbd>]</kbd> change the discount, <kbd>0</kbd> clears a decision.
        </p>
      </section>
      {error && (
        <p role="alert" className="text-xs text-rose-300">
          {error}
        </p>
      )}
    </ScreenWithActions>
  );
}

export function PipelineSubmitting({ error, onRetry, onLobby }: { error: string | null; onRetry: () => void; onLobby: () => void }) {
  return (
    <ScreenWithActions
      actions={
        error ? (
          <>
            <button type="button" onClick={onLobby} className={quiet}>
              Back to lobby
            </button>
            <button type="button" onClick={onRetry} className={primary}>
              Try again
            </button>
          </>
        ) : null
      }
    >
      <div role="status" className="space-y-3 py-10 text-center">
        <p className="text-[11px] font-medium tracking-[0.18em] text-fg-subtle uppercase">Task Performance Report</p>
        {error ? (
          <>
            <h3 className="text-lg font-semibold">Couldn&apos;t reach Sales Operations</h3>
            <p className="text-[13px] text-fg-muted">{error} Your decisions are safe; try again to get your verified result.</p>
          </>
        ) : (
          <>
            <h3 className="text-lg font-semibold">Sales Operations is reviewing your pipeline…</h3>
            <p className="text-[13px] text-fg-muted">The server is scoring your decisions.</p>
          </>
        )}
      </div>
    </ScreenWithActions>
  );
}
