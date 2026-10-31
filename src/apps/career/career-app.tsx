"use client";

import { LadderIcon, LockIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { ProgressBar } from "@/components/ui/progress-bar";
import { RANKS } from "@/career/ranks";
import { getCareerSnapshot, totalXpForLevel } from "@/career/progression";
import { cn } from "@/lib/cn";
import { formatNumber, formatSalary } from "@/lib/format";
import { useCareer } from "@/performance/use-career";
import type { AppProps } from "../types";
import { PerformanceRecord } from "./performance-record";

const LADDER_TOP_DOWN = [...RANKS].reverse();

const XP_SOURCES = [
  { label: "Reconciliation Rush", detail: "1 XP per 20 points scored. Each case pays once.", live: true },
  { label: "Spreadsheet Wars duels", detail: "Win duels, climb faster.", live: false },
  { label: "Daily challenges", detail: "Short tasks, every weekday.", live: false },
  { label: "Achievements", detail: "One-time bonuses for questionable feats.", live: false },
];

export function CareerApp({ employee, openApp }: AppProps) {
  const { progress, rank, nextRank, xpToNextRank } = getCareerSnapshot(employee.xp);
  const currentIndex = RANKS.findIndex((r) => r.id === rank.id);
  const career = useCareer();

  return (
    <div className="space-y-4 p-4 @xl:p-6">
      <section className="relative overflow-hidden rounded-xl border border-line bg-linear-to-br from-surface-raised to-surface p-5">
        <LadderIcon className="pointer-events-none absolute -top-6 -right-6 size-40 text-gold/8" />
        <p className="text-[11px] font-medium tracking-wider text-fg-subtle uppercase">Current rank</p>
        <h3 className="mt-1 text-2xl font-semibold tracking-tight">{rank.title}</h3>
        <p className="mt-1 text-sm text-fg-muted">{rank.perk}</p>

        <dl className="mt-5 grid grid-cols-3 gap-3">
          {[
            ["Level", formatNumber(progress.level)],
            ["Corporate XP", formatNumber(progress.xp)],
            ["Salary", `${formatSalary(rank.salary)}/yr`],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg bg-white/4 px-3 py-2 ring-1 ring-line ring-inset">
              <dt className="text-[11px] text-fg-subtle">{label}</dt>
              <dd className="mt-0.5 text-base font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-5">
          <div className="mb-1.5 flex justify-between text-xs text-fg-muted">
            <span>Level {progress.level} → {progress.level + 1}</span>
            <span className="tabular-nums">
              {formatNumber(progress.xpIntoLevel)} / {formatNumber(progress.nextLevelXp - progress.levelStartXp)} XP
            </span>
          </div>
          <ProgressBar
            value={progress.xpIntoLevel}
            max={progress.nextLevelXp - progress.levelStartXp}
            label={`Progress to level ${progress.level + 1}`}
            tone="gold"
          />
        </div>
      </section>

      <PerformanceRecord career={career} onPlay={() => openApp("spreadsheet-wars")} />

      <div className="grid gap-4 @2xl:grid-cols-[1fr_18rem]">
        <Panel title="The ladder" description="Every rung from intern to the corner office.">
          <ol>
            {LADDER_TOP_DOWN.map((step, i) => {
              const stepIndex = RANKS.length - 1 - i;
              const isCurrent = step.id === rank.id;
              const isReached = stepIndex <= currentIndex;
              const isLast = i === LADDER_TOP_DOWN.length - 1;
              return (
                <li key={step.id} aria-current={isCurrent ? "step" : undefined} className="relative flex gap-3 pb-3 last:pb-0">
                  {!isLast && (
                    <span aria-hidden="true" className={cn("absolute top-5 bottom-0 left-[9px] w-px", isReached ? "bg-gold/40" : "bg-line")} />
                  )}
                  <span
                    aria-hidden="true"
                    className={cn(
                      "relative mt-0.5 grid size-[19px] shrink-0 place-items-center rounded-full border",
                      isCurrent
                        ? "border-gold bg-gold/20 shadow-[0_0_0_4px] shadow-gold/10"
                        : isReached
                          ? "border-gold/60 bg-gold/30"
                          : "border-line-strong bg-surface",
                    )}
                  >
                    {isCurrent && <span className="size-2 rounded-full bg-gold" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn("text-[13px] font-medium", isReached ? "text-fg" : "text-fg-muted")}>{step.title}</span>
                      {isCurrent && <Badge tone="gold">You are here</Badge>}
                    </div>
                    <p className="text-xs text-fg-subtle">
                      Level {step.minLevel} · {formatSalary(step.salary)}/yr
                      {!isReached && <span className="sr-only"> (locked)</span>}
                    </p>
                  </div>
                  {!isReached && <LockIcon className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" />}
                </li>
              );
            })}
          </ol>
        </Panel>

        <div className="space-y-4">
          {nextRank && (
            <Panel title="Next promotion">
              <p className="text-lg font-semibold">{nextRank.title}</p>
              <p className="mt-1 text-xs text-fg-muted">{nextRank.perk}</p>
              <dl className="mt-3 space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <dt className="text-fg-subtle">Requires</dt>
                  <dd>Level {nextRank.minLevel} ({formatNumber(totalXpForLevel(nextRank.minLevel))} XP)</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-fg-subtle">XP to go</dt>
                  <dd className="tabular-nums">{formatNumber(xpToNextRank)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-fg-subtle">New salary</dt>
                  <dd className="text-success">{formatSalary(nextRank.salary)}/yr</dd>
                </div>
              </dl>
            </Panel>
          )}

          <Panel title="Earning XP">
            <ul className="space-y-2.5">
              {XP_SOURCES.map((source) => (
                <li key={source.label} className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[13px]">{source.label}</p>
                    <p className="text-xs text-fg-subtle">{source.detail}</p>
                  </div>
                  {source.live ? <Badge tone="success">Live</Badge> : <Badge>Planned</Badge>}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-fg-subtle">
              {career.source === "cloud"
                ? "Verified XP is saved to your account. Quarterly Performance Reviews come later."
                : "Guest progress is saved in this browser only. Sign in from Employee Profile for verified progress."}
            </p>
            <button
              type="button"
              onClick={() => openApp("spreadsheet-wars")}
              className="mt-3 w-full rounded-lg bg-accent-strong px-3 py-2 text-[13px] font-medium text-white transition-colors hover:bg-accent"
            >
              Open Spreadsheet Wars
            </button>
          </Panel>
        </div>
      </div>
    </div>
  );
}
