"use client";

import { useEffect, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import type { FinishedPipelineRound } from "@/games/pipeline-panic/machine";
import { cn } from "@/lib/cn";
import { formatNumber, formatPercent } from "@/lib/format";
import { CareerResult } from "../spreadsheet-wars/rush/report";
import { formatDuration } from "../spreadsheet-wars/rush/format";
import { ScreenWithActions } from "../spreadsheet-wars/rush/screen-layout";
import { cb, decisionLabel } from "./format";

const GRADE_STYLES: Record<string, string> = {
  "Exceeds Expectations": "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  "Meets Expectations": "border-accent/40 bg-accent-soft text-accent",
  "Needs Improvement": "border-warning/40 bg-warning/10 text-warning",
  "Schedule a Meeting with HR": "border-danger/40 bg-danger/10 text-rose-300",
};

const primary = "rounded-lg bg-emerald-600 px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-emerald-500";
const secondary = "rounded-lg bg-white/6 px-3.5 py-2 text-[13px] font-medium text-fg ring-1 ring-line transition-colors ring-inset hover:bg-white/10";
const quiet = "rounded-lg px-3.5 py-2 text-[13px] font-medium text-fg-muted transition-colors hover:bg-white/6 hover:text-fg";

interface ReportProps {
  finished: FinishedPipelineRound;
  companyContribution: boolean;
  onRetryCareer: () => void;
  onReview: () => void;
  onPlayAgain: () => void;
  onLobby: () => void;
  onOpenCompany: () => void;
}

/** Task Performance Report. Not a Quarterly Performance Review. */
export function PipelineReport({ finished, companyContribution, onRetryCareer, onReview, onPlayAgain, onLobby, onOpenCompany }: ReportProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { score, grade } = finished;
  const decided = finished.total - finished.undecidedCount;
  const accuracy = decided === 0 ? null : finished.correctCount / decided;

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  const stats: [string, string][] = [
    ["Correct decisions", `${finished.correctCount} / ${finished.total}`],
    ["Mistakes", formatNumber(finished.mistakeCount)],
    ["Missed opportunities", formatNumber(finished.missedCount)],
    ["No decision", formatNumber(finished.undecidedCount)],
    ["Accuracy", accuracy === null ? "—" : formatPercent(accuracy)],
    ["Time used", formatDuration(finished.elapsedMs)],
    ["Time remaining", formatDuration(finished.remainingMs)],
  ];

  return (
    <ScreenWithActions
      actions={
        <>
          <button type="button" onClick={onLobby} className={quiet}>
            Back to lobby
          </button>
          <button type="button" onClick={onReview} className={secondary}>
            Review decisions
          </button>
          <button type="button" onClick={onPlayAgain} className={primary}>
            Play again
          </button>
        </>
      }
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium tracking-[0.18em] text-fg-subtle uppercase">Task Performance Report</p>
          <h3 ref={headingRef} tabIndex={-1} className="text-xl font-semibold outline-none">
            Pipeline Panic · {finished.round.quarterLabel}
          </h3>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {finished.mode === "verified" ? <Badge tone="success">Verified by server</Badge> : <Badge>Guest practice</Badge>}
          <Badge tone={finished.outcome === "completed" ? "accent" : "warning"}>{finished.outcome === "completed" ? "Submitted" : "Time's up"}</Badge>
          {finished.assistanceUsed && <Badge>Assistance used</Badge>}
        </div>
      </header>

      <section className="grid gap-4 @lg:grid-cols-[auto_1fr]">
        <div className="rounded-xl border border-line bg-surface-raised/50 px-6 py-4 text-center">
          <p className="text-[11px] tracking-wider text-fg-subtle uppercase">Final score</p>
          <p className="text-4xl font-semibold tabular-nums">{formatNumber(score.total)}</p>
          <p className="text-xs text-fg-muted">of {formatNumber(score.maxPossible)} possible</p>
        </div>
        <div className="space-y-3">
          <p className={cn("inline-flex rounded-lg border px-3 py-1.5 text-sm font-semibold", GRADE_STYLES[grade])}>{grade}</p>
          <blockquote className="border-l-2 border-line-strong pl-3 text-[13px] leading-relaxed text-fg-muted">
            “{finished.feedback}”
            <footer className="mt-1 text-[11px] text-fg-subtle">VP of Sales (on a plane)</footer>
          </blockquote>
        </div>
      </section>

      <CareerResult sessionId={finished.sessionId} verified={finished.mode === "verified"} onRetry={onRetryCareer} />

      {companyContribution && (
        <section aria-label="Company contribution" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-xs">
          <p className="text-fg">
            Counted toward the company this quarter: Sales (Pipeline health).
            <span className="block text-fg-subtle">Company contribution is separate from your XP and capped per quarter.</span>
          </p>
          <button type="button" onClick={onOpenCompany} className="rounded-md bg-white/8 px-2.5 py-1 font-medium text-fg ring-1 ring-line transition-colors ring-inset hover:bg-white/12">
            View company
          </button>
        </section>
      )}

      <dl className="grid grid-cols-2 gap-3 @lg:grid-cols-3">
        {stats.map(([label, value]) => (
          <div key={label} className="rounded-xl border border-line bg-surface-raised/50 px-4 py-3">
            <dt className="text-[11px] text-fg-subtle">{label}</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="pp-breakdown" className="rounded-xl border border-line bg-surface-raised/50 p-4">
        <h4 id="pp-breakdown" className="mb-2 text-sm font-semibold">
          Score breakdown
        </h4>
        <table className="w-full text-[13px]">
          <tbody>
            {score.lines.map((line) => (
              <tr key={line.label} className="border-t border-line first:border-t-0">
                <th scope="row" className="py-1.5 text-left font-normal text-fg-muted">
                  {line.label}
                  {line.count > 0 && <span className="text-fg-subtle"> × {line.count}</span>}
                </th>
                <td className={cn("py-1.5 text-right font-medium tabular-nums", line.points < 0 ? "text-rose-300" : line.points > 0 ? "text-success" : "text-fg-subtle")}>
                  {line.points > 0 ? `+${line.points}` : line.points}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line-strong">
              <th scope="row" className="pt-2 text-left font-semibold">
                Total
              </th>
              <td className="pt-2 text-right font-semibold tabular-nums">{formatNumber(score.total)}</td>
            </tr>
          </tfoot>
        </table>
      </section>
    </ScreenWithActions>
  );
}

const KIND_STYLE: Record<string, { label: string; className: string }> = {
  correct: { label: "Correct", className: "bg-success/12 text-success" },
  leakage: { label: "Revenue leakage", className: "bg-warning/12 text-warning" },
  badDeal: { label: "Bad deal", className: "bg-danger/15 text-rose-300" },
  prioritization: { label: "Prioritization error", className: "bg-danger/15 text-rose-300" },
  missed: { label: "Missed opportunity", className: "bg-danger/15 text-rose-300" },
  misfiled: { label: "Misfiled", className: "bg-warning/12 text-warning" },
  undecided: { label: "No decision", className: "bg-white/6 text-fg-muted" },
};

/** Decision Review: why each decision was right or wrong. */
export function PipelineReview({ finished, onBack, onPlayAgain }: { finished: FinishedPipelineRound; onBack: () => void; onPlayAgain: () => void }) {
  const byId = new Map(finished.round.opportunities.map((o) => [o.id, o]));
  return (
    <ScreenWithActions
      actions={
        <>
          <button type="button" onClick={onBack} className={secondary}>
            Back to report
          </button>
          <button type="button" onClick={onPlayAgain} className={primary}>
            Play again
          </button>
        </>
      }
    >
      <p className="text-[11px] font-medium tracking-[0.18em] text-fg-subtle uppercase">Decision review</p>
      <h3 className="text-xl font-semibold">Every call, explained</h3>
      <p className="text-xs text-fg-muted">Only opportunities you decided are explained, so the others stay a mystery for next time.</p>
      <ol className="space-y-2.5">
        {finished.outcomes.map((outcome) => {
          const o = byId.get(outcome.id)!;
          const style = KIND_STYLE[outcome.kind];
          if (outcome.kind === "undecided") {
            return (
              <li key={outcome.id} className="rounded-xl border border-dashed border-line bg-surface-raised/30 p-3.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-[13px] font-semibold">{o.account}</p>
                    <p className="text-[11px] text-fg-subtle">
                      {o.product} · list {cb(o.listPrice)}
                    </p>
                  </div>
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", style.className)}>{style.label}</span>
                </div>
                <p className="mt-2 text-xs text-fg-muted">No decision recorded. The opportunity was not evaluated.</p>
              </li>
            );
          }
          const points = outcome.points;
          return (
            <li key={outcome.id} className="rounded-xl border border-line bg-surface-raised/50 p-3.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-[13px] font-semibold">{o.account}</p>
                  <p className="text-[11px] text-fg-subtle">
                    {o.product} · list {cb(o.listPrice)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", style.className)}>{style.label}</span>
                  <span className={cn("text-[13px] font-semibold tabular-nums", points < 0 ? "text-rose-300" : points > 0 ? "text-success" : "text-fg-subtle")}>
                    {points > 0 ? `+${points}` : points}
                  </span>
                </div>
              </div>
              <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs @lg:grid-cols-2">
                <div>
                  <dt className="text-fg-subtle">Your decision</dt>
                  <dd>{decisionLabel(outcome.decision)}</dd>
                </div>
                <div>
                  <dt className="text-fg-subtle">Best decision</dt>
                  <dd>{decisionLabel(outcome.bestDecision)}</dd>
                </div>
              </dl>
              <p className="mt-2 text-xs text-fg-muted">{outcome.explanation}</p>
              {outcome.kind !== "correct" && <p className="mt-1 text-xs text-fg-subtle">{outcome.verdict}</p>}
              {finished.hint?.opportunityId === outcome.id && <p className="mt-1 text-[11px] text-sky-300">Sales Operations hinted at this one.</p>}
            </li>
          );
        })}
      </ol>
    </ScreenWithActions>
  );
}
