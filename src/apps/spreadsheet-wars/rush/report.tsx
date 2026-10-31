"use client";

import { useEffect, useId, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import type { FinishedRound } from "@/games/spreadsheet-wars/reconciliation-rush/machine";
import {
  correctionAccuracy,
  managerFeedback,
  type PerformanceGrade,
} from "@/games/spreadsheet-wars/reconciliation-rush/report";
import { toGameResult } from "@/games/spreadsheet-wars/reconciliation-rush/result";
import { cn } from "@/lib/cn";
import { formatNumber, formatPercent } from "@/lib/format";
import { getCareerStore, useCareerSession } from "@/performance/use-career";
import { formatDuration } from "./format";
import { ScreenWithActions } from "./screen-layout";

const GRADE_STYLES: Record<PerformanceGrade, string> = {
  "Exceeds Expectations": "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  "Meets Expectations": "border-accent/40 bg-accent-soft text-accent",
  "Needs Improvement": "border-warning/40 bg-warning/10 text-warning",
  "Schedule a Meeting with HR": "border-danger/40 bg-danger/10 text-rose-300",
};

interface TaskPerformanceReportProps {
  round: FinishedRound;
  onPlayAgain: () => void;
  onReview: () => void;
  onLobby: () => void;
  /** True when the server recorded this verified round in the company's contribution ledger. */
  companyContribution?: boolean;
  onOpenCompany?: () => void;
}

/** Post-round results. Not a Quarterly Performance Review; nothing here is saved. */
export function TaskPerformanceReport({ round, onPlayAgain, onReview, onLobby, companyContribution, onOpenCompany }: TaskPerformanceReportProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const id = useId();
  const { evaluation, score, grade, challenge } = round;
  const accuracy = correctionAccuracy(evaluation);
  const total = evaluation.errors.length;

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  const stats: ReadonlyArray<[label: string, value: string]> = [
    ["Errors fixed", `${evaluation.fixedCount} / ${total}`],
    ["Accuracy", accuracy === null ? "—" : formatPercent(accuracy)],
    ["Time used", formatDuration(round.elapsedMs)],
    ["Time remaining", formatDuration(round.remainingMs)],
  ];

  return (
    <ScreenWithActions
      actions={
        <>
          <button
            type="button"
            onClick={onLobby}
            className="rounded-lg px-3.5 py-2 text-[13px] font-medium text-fg-muted transition-colors hover:bg-white/6 hover:text-fg"
          >
            Back to lobby
          </button>
          <button
            type="button"
            onClick={onReview}
            className="rounded-lg bg-white/8 px-3.5 py-2 text-[13px] font-medium text-fg ring-1 ring-line transition-colors ring-inset hover:bg-white/12"
          >
            Review mistakes
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
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
        <div>
          <p className="text-[11px] font-medium tracking-[0.18em] text-fg-subtle uppercase">Task Performance Report</p>
          <h3 ref={headingRef} tabIndex={-1} className="mt-1 text-xl font-semibold tracking-tight focus:outline-none">
            Reconciliation Rush · {challenge.department}
          </h3>
          <p className="mt-0.5 font-mono text-[11px] text-fg-subtle">
            Case {challenge.seed} · {challenge.fileName}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {round.mode === "verified" ? <Badge tone="success">Verified by server</Badge> : <Badge>Guest practice</Badge>}
          <Badge tone={round.outcome === "completed" ? "accent" : "warning"}>
            {round.outcome === "completed" ? "Submitted" : "Time expired"}
          </Badge>
        </div>
      </header>

      <section aria-labelledby={`${id}-score`} className="grid gap-4 @lg:grid-cols-[auto_1fr] @lg:items-center">
        <div className="rounded-xl border border-line bg-surface-raised/70 px-6 py-4 text-center">
          <p id={`${id}-score`} className="text-[11px] tracking-wider text-fg-subtle uppercase">
            Final score
          </p>
          <p className="mt-1 text-4xl font-semibold tabular-nums">{formatNumber(score.total)}</p>
          <p className="mt-0.5 text-[11px] text-fg-subtle tabular-nums">of {formatNumber(score.maxPossible)} possible</p>
        </div>
        <div className="space-y-3">
          <p className={cn("inline-flex rounded-lg border px-3 py-1.5 text-sm font-semibold", GRADE_STYLES[grade])}>{grade}</p>
          <blockquote className="border-l-2 border-line-strong pl-3 text-[13px] leading-relaxed text-fg-muted">
            “{managerFeedback(grade, challenge.seed)}”
            <footer className="mt-1 text-[11px] text-fg-subtle">Your manager (out of office)</footer>
          </blockquote>
        </div>
      </section>

      <CareerResult round={round} />

      {companyContribution && (
        <section
          aria-label="Company contribution"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-xs"
        >
          <p className="text-fg">
            Counted toward the company this quarter: Controlling (Ledger integrity) and Finance (Close quality).
            <span className="block text-fg-subtle">Company contribution is separate from your XP and capped per quarter.</span>
          </p>
          {onOpenCompany && (
            <button
              type="button"
              onClick={onOpenCompany}
              className="rounded-md bg-white/8 px-2.5 py-1 font-medium text-fg ring-1 ring-line transition-colors ring-inset hover:bg-white/12"
            >
              View company
            </button>
          )}
        </section>
      )}

      <dl className="grid grid-cols-2 gap-3 @lg:grid-cols-4">
        {stats.map(([label, value]) => (
          <div key={label} className="rounded-xl border border-line bg-surface-raised/50 px-4 py-3">
            <dt className="text-[11px] text-fg-subtle">{label}</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby={`${id}-breakdown`} className="rounded-xl border border-line bg-surface-raised/40 p-4">
        <h4 id={`${id}-breakdown`} className="text-sm font-semibold">
          Score breakdown
        </h4>
        <table className="mt-2 w-full text-[13px]">
          <tbody className="divide-y divide-line">
            {score.lines.map((line, i) => (
              <tr key={i}>
                <th scope="row" className="py-1.5 pr-3 text-left font-normal text-fg-muted">
                  {line.label}
                </th>
                <td
                  className={cn(
                    "py-1.5 text-right font-medium tabular-nums",
                    line.points > 0 ? "text-success" : line.points < 0 ? "text-rose-300" : "text-fg-subtle",
                  )}
                >
                  {line.points > 0 ? "+" : ""}
                  {formatNumber(line.points)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line-strong">
              <th scope="row" className="pt-2 text-left font-semibold">
                Total (minimum 0)
              </th>
              <td className="pt-2 text-right font-semibold tabular-nums">{formatNumber(score.total)}</td>
            </tr>
          </tfoot>
        </table>
        <p className="mt-3 text-xs text-fg-muted">
          Assistance used: <span className="font-medium text-fg">{round.assistanceUsed ? "Yes" : "No"}</span>
          {round.hint && <span className="text-fg-subtle"> · requested at {formatDuration(round.hint.requestedAtMs)} · no score effect</span>}
        </p>
      </section>
    </ScreenWithActions>
  );
}

/** Shows what the career system actually recorded. Never claims XP that wasn't saved. */
function CareerResult({ round }: { round: FinishedRound }) {
  const outcome = useCareerSession(round.sessionId);

  if (!outcome || outcome.status === "saving") {
    return (
      <p role="status" className="rounded-xl border border-line bg-surface-raised/40 px-4 py-3 text-xs text-fg-muted">
        Recording result in your career…
      </p>
    );
  }

  if (outcome.status === "failed") {
    return (
      <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/40 bg-danger/8 px-4 py-3 text-xs">
        <p className="text-rose-200">
          {outcome.reason} No Corporate XP was added and your career is unchanged.
        </p>
        <button
          type="button"
          onClick={() => void getCareerStore().recordResult(round.sessionId, toGameResult(round, new Date()))}
          className="rounded-md bg-white/8 px-2.5 py-1 font-medium text-fg ring-1 ring-line transition-colors ring-inset hover:bg-white/12"
        >
          Try again
        </button>
      </div>
    );
  }

  const { record, award, change } = outcome;
  const reason = award?.reason;
  return (
    <section role="status" aria-label="Career update" className="rounded-xl border border-gold/30 bg-gold-soft px-4 py-3 text-xs">
      <p className="text-fg">
        {record.xpAwarded > 0 ? (
          <>
            <span className="font-semibold text-gold">+{formatNumber(record.xpAwarded)} Corporate XP</span> added to your{" "}
            {round.mode === "verified" ? "account" : "career"}.
          </>
        ) : reason === "repeatCase" ? (
          "No Corporate XP: this case was already completed before. Replays don't pay twice."
        ) : (
          "No Corporate XP this round: the score was too low to count."
        )}
      </p>
      {change.promoted ? (
        <p className="mt-1 font-semibold text-gold">
          Promoted: {change.rankBefore.title} → {change.rankAfter.title}
        </p>
      ) : (
        change.leveledUp && (
          <p className="mt-1 text-fg-muted">
            Level up: {change.levelBefore} → {change.levelAfter}
          </p>
        )
      )}
      <p className="mt-1 text-fg-subtle">
        {round.mode === "verified"
          ? "Verified by the server and saved to your account."
          : "Saved in this browser only (guest practice)."}{" "}
        Open Corporate Career to see your progress.
      </p>
    </section>
  );
}
