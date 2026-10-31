"use client";

import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/notice";
import { Panel } from "@/components/ui/panel";
import {
  RECONCILIATION_RUSH_DIFFICULTY,
  RECONCILIATION_RUSH_GAME_ID,
  RECONCILIATION_RUSH_SCORING_VERSION,
} from "@/games/spreadsheet-wars/reconciliation-rush/result";
import { formatNumber, formatPercent } from "@/lib/format";
import type { CareerState } from "@/performance/career-store";
import { comparisonKey, personalBest, recentResults, scoreShare, summarizePerformance } from "@/performance/stats";
import { LegacyPractice } from "./legacy-practice";

const timestampFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const BEST_KEY = comparisonKey({
  gameId: RECONCILIATION_RUSH_GAME_ID,
  difficulty: RECONCILIATION_RUSH_DIFFICULTY,
  scoringVersion: RECONCILIATION_RUSH_SCORING_VERSION,
});

const percentOrDash = (value: number | null) => (value === null ? "—" : formatPercent(value));

function StorageNotice({ career }: { career: CareerState }) {
  switch (career.loadStatus) {
    case "unavailable":
      return (
        <Notice tone="warning" title="Progress can't be saved in this browser">
          Storage is blocked or unavailable (for example in a private window). Rounds still work, but no XP is recorded.
        </Notice>
      );
    case "recovered":
      return (
        <Notice tone="warning" title="Some saved career data was damaged">
          Unreadable entries were set aside and everything that could be restored was kept.
        </Notice>
      );
    case "offline":
      return (
        <Notice tone="warning" title="Can't reach the server">
          Showing your last known progress. It will refresh when the connection is back.
        </Notice>
      );
    case "unauthorized":
      return (
        <Notice tone="warning" title="Your session expired">
          Sign in again from Employee Profile to keep saving verified progress.
        </Notice>
      );
    case "unsupportedVersion":
      return (
        <Notice tone="warning" title="Saved by a newer version">
          Your career data comes from a newer version of Corporate Ladder. It is left untouched and new rounds aren&apos;t
          recorded here.
        </Notice>
      );
    default:
      return null;
  }
}

/** Career statistics and recent history for the Corporate Career app. */
export function PerformanceRecord({ career, onPlay }: { career: CareerState; onPlay: () => void }) {
  const summary = summarizePerformance(career.records);
  const best = personalBest(career.records, BEST_KEY);
  const recent = recentResults(career.records, 5);

  const stats: ReadonlyArray<[label: string, value: string, detail?: string]> = [
    ["Rounds completed", formatNumber(summary.gamesPlayed)],
    ["Errors fixed", formatNumber(summary.totalErrorsFixed), summary.totalErrors ? `of ${formatNumber(summary.totalErrors)}` : undefined],
    [
      "Personal best",
      best ? formatNumber(best.score) : "—",
      best ? `of ${formatNumber(best.maxScore)} · ${formatPercent(scoreShare(best))}` : undefined,
    ],
    ["Avg. accuracy", percentOrDash(summary.averageAccuracy)],
  ];

  return (
    <Panel
      title="Performance record"
      description={
        career.source === "cloud"
          ? "Reconciliation Rush · Verified results · Cloud account"
          : "Reconciliation Rush · Guest practice · Saved in this browser only"
      }
      actions={<Badge tone="gold">{formatNumber(summary.totalXp)} XP earned</Badge>}
    >
      {career.status === "loading" ? (
        <p className="text-xs text-fg-subtle">Loading your record…</p>
      ) : (
        <div className="space-y-4">
          <StorageNotice career={career} />
          {career.source === "cloud" && <LegacyPractice career={career} />}

          <dl className="grid grid-cols-2 gap-3 @xl:grid-cols-4">
            {stats.map(([label, value, detail]) => (
              <div key={label} className="rounded-lg bg-white/4 px-3 py-2 ring-1 ring-line ring-inset">
                <dt className="text-[11px] text-fg-subtle">{label}</dt>
                <dd className="mt-0.5 text-base font-semibold tabular-nums">{value}</dd>
                {detail && <dd className="text-[11px] text-fg-subtle tabular-nums">{detail}</dd>}
              </div>
            ))}
          </dl>

          {summary.gamesPlayed > 0 && (
            <p className="text-xs text-fg-subtle">
              Average share of max score: unassisted {percentOrDash(summary.unassisted.averageScoreShare)} (
              {summary.unassisted.gamesPlayed}) · with assistance {percentOrDash(summary.assisted.averageScoreShare)} (
              {summary.assisted.gamesPlayed})
            </p>
          )}

          <div>
            <h4 className="text-[13px] font-semibold">Recent rounds</h4>
            {recent.length === 0 ? (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-line px-3 py-3">
                <p className="text-xs text-fg-muted">No completed rounds yet. Your career awaits its first reconciliation.</p>
                <button
                  type="button"
                  onClick={onPlay}
                  className="rounded-md bg-accent-strong px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-accent"
                >
                  Play Reconciliation Rush
                </button>
              </div>
            ) : (
              <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
                {recent.map((record) => (
                  <li key={record.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs">
                    <span className="w-24 shrink-0 text-fg-subtle tabular-nums">{timestampFormat.format(new Date(record.completedAt))}</span>
                    <span className="min-w-0 flex-1 truncate">
                      {record.department} · <span className="text-fg-muted">{record.grade}</span>
                    </span>
                    <span className="tabular-nums">
                      {formatNumber(record.score)} / {formatNumber(record.maxScore)}
                    </span>
                    <span className="text-fg-subtle tabular-nums">
                      {record.errorsFixed}/{record.totalErrors} fixed
                    </span>
                    {record.completion === "timedOut" && <Badge tone="warning">Timed out</Badge>}
                    {record.assistanceUsed && <Badge tone="accent">Assisted</Badge>}
                    {career.source === "cloud" && <Badge tone="success">Verified</Badge>}
                    <span className="w-14 text-right font-medium text-gold tabular-nums">+{record.xpAwarded} XP</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}
