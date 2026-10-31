"use client";

import { useEffect, useId, useRef } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { ERRORS_PER_ROUND } from "@/games/spreadsheet-wars/reconciliation-rush/generate";
import { ROUND_DURATION_MS } from "@/games/spreadsheet-wars/reconciliation-rush/machine";
import {
  DIFFICULTY_POINTS,
  INCORRECT_CORRECTION_PENALTY,
  MAX_TIME_BONUS,
} from "@/games/spreadsheet-wars/reconciliation-rush/scoring";
import type { Challenge } from "@/games/spreadsheet-wars/reconciliation-rush/types";
import { ScreenWithActions } from "./screen-layout";

interface BriefingProps {
  /** Guest practice knows its case up front; verified cases are assigned by the server at Start. */
  challenge: Challenge | null;
  mode: "local" | "verified";
  starting?: boolean;
  error?: string | null;
  onStart: () => void;
  onBack: () => void;
}

const CONTROLS: ReadonlyArray<[keys: string, action: string]> = [
  ["Arrow keys", "Move between cells"],
  ["Enter · Double-click · Type", "Edit a cell"],
  ["Enter · Tab", "Confirm the edit"],
  ["Esc", "Cancel the edit"],
  ["=", "Start a formula, e.g. =D4*E4"],
];

export function Briefing({ challenge, mode, starting = false, error = null, onStart, onBack }: BriefingProps) {
  const startRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const seconds = ROUND_DURATION_MS / 1000;

  useEffect(() => {
    startRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <ScreenWithActions
      actions={
        <>
          <p className="mr-auto text-xs text-fg-subtle">
            {mode === "verified"
              ? "Associate · Verified by the server · Saved to your account"
              : "Associate · Guest practice · Saved in this browser only"}
          </p>
          <button
            type="button"
            disabled
            title="Available once the round starts"
            className="rounded-lg bg-white/5 px-3 py-2 text-[13px] font-medium text-fg-subtle"
          >
            Request Assistance (1/1)
          </button>
          <button
            ref={startRef}
            type="button"
            onClick={onStart}
            disabled={starting}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-60"
          >
            {starting ? "Starting…" : error ? "Try again" : `Start · ${seconds}s`}
            <ChevronRightIcon className="size-4" />
          </button>
        </>
      }
    >
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-fg-muted transition-colors hover:bg-white/6 hover:text-fg"
        >
          <ChevronLeftIcon className="size-4" />
          Lobby
        </button>
        <span className="font-mono text-[11px] text-fg-subtle">
          {challenge ? `Case ${challenge.seed}` : "Case assigned when you start"}
        </span>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-danger/40 bg-danger/8 px-3 py-2 text-[13px] text-rose-200">
          {error}
        </p>
      )}

      <article aria-labelledby={`${id}-subject`} className="overflow-hidden rounded-xl border border-line bg-surface-raised/70">
        <dl className="grid grid-cols-[4.5rem_1fr] gap-y-1 border-b border-line px-5 py-3 text-[12px]">
          <dt className="text-fg-subtle">From</dt>
          <dd>Finance Operations</dd>
          <dt className="text-fg-subtle">To</dt>
          <dd>You (Unpaid Intern)</dd>
          <dt className="text-fg-subtle">Sent</dt>
          <dd>Friday, 4:57 PM</dd>
          <dt className="text-fg-subtle">Subject</dt>
          <dd>
            <h3 id={`${id}-subject`} className="font-semibold text-fg">
              URGENT — {challenge?.title ?? "Q4"} reconciliation
            </h3>
          </dd>
        </dl>
        <div className="space-y-3 px-5 py-4 text-[13px] leading-relaxed">
          <p>
            Management needs these figures reconciled before the board meeting. Your performance will be monitored. Your
            overtime will not.
          </p>
          <p className="text-fg-muted">
            {challenge ? (
              <>
                {challenge.department} sent over <span className="font-mono text-fg">{challenge.fileName}</span>.
              </>
            ) : (
              "A department will send its ledger the moment you press Start."
            )}{" "}
            It contains exactly <strong className="text-fg">{ERRORS_PER_ROUND} errors</strong>: typos, bad arithmetic,
            broken formulas and figures that don&apos;t match the paperwork. Your manager has already left.
          </p>
        </div>
      </article>

      <div className="grid gap-3 @2xl:grid-cols-2">
        <section aria-labelledby={`${id}-task`} className="rounded-xl border border-line bg-surface-raised/40 p-4">
          <h4 id={`${id}-task`} className="text-sm font-semibold">
            Your assignment
          </h4>
          <ul className="mt-2 space-y-1.5 text-[13px] text-fg-muted">
            <li>
              <span className="text-fg">Find and fix {ERRORS_PER_ROUND} errors</span> in a{" "}
              {challenge ? `${challenge.ledgerRowCount}-row` : "12–20 row"} ledger.
            </li>
            <li>
              <span className="text-fg">{seconds} seconds.</span> The clock starts when you press Start and keeps running if
              you minimize the window.
            </li>
            <li>
              <span className="text-fg">Select a row</span> to see its invoice, purchase order or expense report. Summary
              rows show the finance memo.
            </li>
            <li>
              <span className="text-fg">Record final figures:</span> net prices, revised and delivered quantities, approved
              expense totals.
            </li>
            <li>Only confirmed edits count. An edit still open when time runs out is discarded.</li>
            {mode === "verified" && (
              <li>
                <span className="text-fg">Verified play:</span> the server keeps the official clock and scores your sheet.
                It accepts submissions up to 3 seconds after time runs out.
              </li>
            )}
            <li>
              <span className="text-fg">Stuck?</span> Request Assistance once per round and Finance Operations will point
              you to one unresolved row. The clock keeps running.
            </li>
          </ul>
        </section>

        <section aria-labelledby={`${id}-controls`} className="rounded-xl border border-line bg-surface-raised/40 p-4">
          <h4 id={`${id}-controls`} className="text-sm font-semibold">
            Controls
          </h4>
          <dl className="mt-2 space-y-1.5 text-[12px]">
            {CONTROLS.map(([keys, action]) => (
              <div key={keys} className="flex justify-between gap-3">
                <dt className="font-mono text-fg">{keys}</dt>
                <dd className="text-right text-fg-muted">{action}</dd>
              </div>
            ))}
          </dl>
          <h4 className="mt-4 text-sm font-semibold">Scoring</h4>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge tone="success">Easy +{DIFFICULTY_POINTS.easy}</Badge>
            <Badge tone="success">Medium +{DIFFICULTY_POINTS.medium}</Badge>
            <Badge tone="success">Hard +{DIFFICULTY_POINTS.hard}</Badge>
            <Badge tone="warning">Wrong change −{INCORRECT_CORRECTION_PENALTY}</Badge>
            <Badge tone="gold">Time bonus up to +{MAX_TIME_BONUS} (all fixed)</Badge>
          </div>
        </section>
      </div>
    </ScreenWithActions>
  );
}
