"use client";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/notice";
import { getCareerSnapshot } from "@/career/progression";
import { cn } from "@/lib/cn";
import { formatNumber, formatPercent } from "@/lib/format";
import { getLeaderboard } from "@/services/leaderboard-service";
import { useCareer } from "@/performance/use-career";
import type { AppProps } from "../types";

const ENTRIES = getLeaderboard();

const PODIUM_STYLES: Record<number, string> = {
  1: "bg-gold/20 text-gold ring-gold/40",
  2: "bg-slate-300/15 text-slate-200 ring-slate-300/30",
  3: "bg-orange-400/15 text-orange-300 ring-orange-400/30",
};

const SCOPES = [
  { label: "Global", available: true },
  { label: "Department", available: false },
  { label: "Friends", available: false },
];

export function LeaderboardApp({ employee, openApp }: AppProps) {
  const you = getCareerSnapshot(employee.xp);
  const roundsPlayed = useCareer().records.length;

  return (
    <div className="space-y-4 p-4 @xl:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-xl font-semibold tracking-tight">Global leaderboard</h3>
          <p className="text-xs text-fg-muted">Preseason · Season 0</p>
        </div>
        <div role="group" aria-label="Leaderboard scope" className="flex rounded-lg bg-white/5 p-0.5 ring-1 ring-line ring-inset">
          {SCOPES.map((scope) => (
            <button
              key={scope.label}
              type="button"
              aria-pressed={scope.available}
              disabled={!scope.available}
              title={scope.available ? undefined : "Coming soon"}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium",
                scope.available ? "bg-surface-hover text-fg shadow-sm" : "text-fg-subtle",
              )}
            >
              {scope.label}
            </button>
          ))}
        </div>
      </header>

      <Notice tone="warning" title="Sample data">
        These employees and scores are fictional placeholders. No matches have been played and nothing here is live.
        Real rankings arrive with server-validated ranked play.
      </Notice>

      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full text-left text-[13px]">
          <caption className="sr-only">Mock leaderboard ranked by Corporate XP</caption>
          <thead className="bg-white/3 text-[11px] tracking-wide text-fg-subtle uppercase">
            <tr>
              <th scope="col" className="w-12 px-3 py-2.5 font-medium">#</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Employee</th>
              <th scope="col" className="hidden px-3 py-2.5 font-medium @xl:table-cell">Department</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Level</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">XP</th>
              <th scope="col" className="hidden px-3 py-2.5 text-right font-medium @2xl:table-cell">W–L</th>
              <th scope="col" className="hidden px-3 py-2.5 text-right font-medium @lg:table-cell">Win rate</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {ENTRIES.map((entry) => {
              const { progress, rank } = getCareerSnapshot(entry.xp);
              const winRate = entry.wins / Math.max(1, entry.wins + entry.losses);
              return (
                <tr key={entry.handle} className="transition-colors hover:bg-white/3">
                  <td className="px-3 py-2.5">
                    <span
                      className={cn(
                        "inline-grid size-6 place-items-center rounded-full text-[11px] font-semibold tabular-nums ring-1 ring-inset",
                        PODIUM_STYLES[entry.position] ?? "text-fg-muted ring-transparent",
                      )}
                    >
                      {entry.position}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <p className="font-mono text-[12.5px] text-fg">@{entry.handle}</p>
                    <p className="text-[11px] text-fg-subtle">{rank.title}</p>
                  </td>
                  <td className="hidden px-3 py-2.5 text-fg-muted @xl:table-cell">{entry.department}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{progress.level}</td>
                  <td className="px-3 py-2.5 text-right font-medium tabular-nums">{formatNumber(entry.xp)}</td>
                  <td className="hidden px-3 py-2.5 text-right text-fg-muted tabular-nums @2xl:table-cell">
                    {entry.wins}–{entry.losses}
                  </td>
                  <td className="hidden px-3 py-2.5 text-right text-fg-muted tabular-nums @lg:table-cell">
                    {formatPercent(winRate)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <section
        aria-label="Your standing"
        className="flex flex-wrap items-center gap-3 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3"
      >
        <Avatar name={employee.displayName} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium">
            {employee.displayName} <Badge className="ml-1">Unranked</Badge>
          </p>
          <p className="text-xs text-fg-muted">
            {you.rank.title} · Level {you.progress.level} · {roundsPlayed} {roundsPlayed === 1 ? "round" : "rounds"} played (not ranked yet)
          </p>
        </div>
        <button
          type="button"
          onClick={() => openApp("spreadsheet-wars")}
          className="rounded-lg bg-accent-strong px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent"
        >
          Preview Spreadsheet Wars
        </button>
      </section>
    </div>
  );
}
