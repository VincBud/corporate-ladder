"use client";

import { useEffect, useId, useRef } from "react";
import { ChevronLeftIcon } from "@/components/icons";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { COL } from "@/games/spreadsheet-wars/reconciliation-rush/generate";
import type { FinishedRound } from "@/games/spreadsheet-wars/reconciliation-rush/machine";
import { CATEGORY_LABELS, DIFFICULTY_POINTS, INCORRECT_CORRECTION_PENALTY } from "@/games/spreadsheet-wars/reconciliation-rush/scoring";
import type { Challenge } from "@/games/spreadsheet-wars/reconciliation-rush/types";
import type { ErrorStatus } from "@/games/spreadsheet-wars/reconciliation-rush/validate";
import { addressLabel, cellKey, type CellAddress } from "@/games/spreadsheet-wars/sheet";
import { describeContent } from "./format";
import { ScreenWithActions } from "./screen-layout";
import { SourceDocumentCard } from "./source-document";

const STATUS: Record<ErrorStatus, { label: string; tone: BadgeTone }> = {
  fixed: { label: "Fixed", tone: "success" },
  missed: { label: "Missed", tone: "neutral" },
  incorrect: { label: "Incorrect fix", tone: "warning" },
};

function rowContext(challenge: Challenge, address: CellAddress): string {
  const ref = challenge.cells.get(cellKey({ row: address.row, col: COL.ref }))?.solution;
  const vendor = challenge.cells.get(cellKey({ row: address.row, col: COL.vendor }))?.solution;
  const label = challenge.cells.get(cellKey({ row: address.row, col: COL.price }));
  if (ref && vendor) return `Row ${address.row + 1} · ${ref} · ${vendor}`;
  if (label?.role === "label") return `Row ${address.row + 1} · ${label.solution}`;
  return `Row ${address.row + 1}`;
}

interface ReviewProps {
  round: FinishedRound;
  onBack: () => void;
  onPlayAgain: () => void;
}

/** Post-round review. Correct answers are only ever shown here, after the round has ended. */
export function MistakeReview({ round, onBack, onPlayAgain }: ReviewProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const id = useId();
  const { challenge, evaluation } = round;
  const formatOf = (address: CellAddress) => challenge.cells.get(cellKey(address))?.format ?? "text";

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <ScreenWithActions
      actions={
        <>
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg bg-white/8 px-3.5 py-2 text-[13px] font-medium text-fg ring-1 ring-line transition-colors ring-inset hover:bg-white/12"
          >
            Back to report
          </button>
          <button
            type="button"
            onClick={onPlayAgain}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-emerald-500"
          >
            Play again
          </button>
        </>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-fg-muted transition-colors hover:bg-white/6 hover:text-fg"
        >
          <ChevronLeftIcon className="size-4" />
          Task Performance Report
        </button>
        <span className="font-mono text-[11px] text-fg-subtle">Case {challenge.seed}</span>
      </div>

      <header>
        <h3 ref={headingRef} tabIndex={-1} className="text-xl font-semibold tracking-tight focus:outline-none">
          Mistake review
        </h3>
        <p className="mt-0.5 text-[13px] text-fg-muted">
          {evaluation.fixedCount} of {evaluation.errors.length} errors fixed
          {evaluation.collateral.length > 0 &&
            ` · ${evaluation.collateral.length} correct ${evaluation.collateral.length === 1 ? "cell" : "cells"} changed`}
          .
        </p>
      </header>

      <ol className="space-y-3">
        {evaluation.errors.map((outcome) => {
          const { error } = outcome;
          const status = STATUS[outcome.status];
          const format = formatOf(error.address);
          const document = challenge.documents.find((d) => d.id === error.documentId);
          return (
            <li key={error.id} className="rounded-xl border border-line bg-surface-raised/50 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={status.tone}>{status.label}</Badge>
                <span className="font-mono text-[13px] font-semibold">{addressLabel(error.address)}</span>
                {round.hint?.errorId === error.id && <Badge tone="accent">Assistance given</Badge>}
                <span className="text-xs text-fg-subtle">{rowContext(challenge, error.address)}</span>
                <span className="ml-auto text-[11px] text-fg-subtle">
                  {CATEGORY_LABELS[error.category]} · {error.difficulty} · {DIFFICULTY_POINTS[error.difficulty]} pts
                </span>
              </div>

              <dl className="mt-3 grid gap-2 text-[12px] @lg:grid-cols-3">
                <div className="rounded-lg bg-white/4 px-3 py-2">
                  <dt className="text-[11px] text-fg-subtle">Shown in sheet</dt>
                  <dd className="font-mono">{describeContent(outcome.shownContent, format)}</dd>
                </div>
                <div className="rounded-lg bg-white/4 px-3 py-2">
                  <dt className="text-[11px] text-fg-subtle">Your final entry</dt>
                  <dd className="font-mono">
                    {outcome.status === "missed" ? "Unchanged" : describeContent(outcome.playerContent, format)}
                  </dd>
                </div>
                <div className="rounded-lg bg-emerald-500/10 px-3 py-2 ring-1 ring-emerald-500/25 ring-inset">
                  <dt className="text-[11px] text-emerald-300/80">Correct</dt>
                  <dd className="font-mono text-emerald-200">{describeContent(outcome.correctContent, format)}</dd>
                </div>
              </dl>

              <p className="mt-3 text-[13px] leading-relaxed text-fg-muted">{error.explanation}</p>
              <p className="mt-1 text-[12px] text-fg-subtle">
                Evidence: <span className="text-fg">{error.evidence}</span>
              </p>

              {document && (
                <details className="group mt-2">
                  <summary className="cursor-pointer text-[12px] font-medium text-accent hover:underline">
                    View {document.title.toLowerCase()} {document.number}
                  </summary>
                  <SourceDocumentCard document={document} className="mt-2 max-w-sm" />
                </details>
              )}
            </li>
          );
        })}
      </ol>

      {evaluation.collateral.length > 0 && (
        <section aria-labelledby={`${id}-collateral`} className="rounded-xl border border-warning/30 bg-warning/6 p-4">
          <h4 id={`${id}-collateral`} className="text-sm font-semibold">
            Correct cells you changed (−{INCORRECT_CORRECTION_PENALTY} each)
          </h4>
          <ul className="mt-2 space-y-1.5 text-[12px]">
            {evaluation.collateral.map((change) => {
              const format = formatOf(change.address);
              return (
                <li key={cellKey(change.address)} className="flex flex-wrap gap-x-3 gap-y-0.5">
                  <span className="font-mono font-semibold">{addressLabel(change.address)}</span>
                  <span className="text-fg-subtle">{rowContext(challenge, change.address)}</span>
                  <span>
                    was <span className="font-mono">{describeContent(change.originalContent, format)}</span>, you entered{" "}
                    <span className="font-mono">{describeContent(change.playerContent, format)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </ScreenWithActions>
  );
}
