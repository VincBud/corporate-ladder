"use client";

import { useState } from "react";
import { LockIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { ProgressBar } from "@/components/ui/progress-bar";
import { ACHIEVEMENTS, ACHIEVEMENT_CATEGORIES, type AchievementCategory } from "@/career/achievements";
import { cn } from "@/lib/cn";
import { formatTimestampDate } from "@/lib/format";
import type { CareerState } from "@/performance/career-store";
import { AchievementGlyph, RARITY } from "./achievement-icon";

const CATEGORY_LABELS: Record<AchievementCategory, string> = {
  gameplay: "Gameplay",
  career: "Career",
  department: "Department",
  company: "Company",
};

export const AVAILABLE_ACHIEVEMENTS = ACHIEVEMENTS.filter((a) => a.status === "available");

/** Achievements for the Employee Profile: real, server-computed data for accounts; a preview for guests. */
export function AchievementsPanel({ career, onSignIn }: { career: CareerState; onSignIn?: () => void }) {
  const [filter, setFilter] = useState<AchievementCategory | "all">("all");
  const signedIn = career.source === "cloud";
  const summary = career.achievements;
  const unlocked = new Map((summary?.unlocked ?? []).map((u) => [u.id, u]));
  const visible = ACHIEVEMENTS.filter((a) => filter === "all" || a.category === filter);

  return (
    <Panel
      title="Achievements"
      description={
        !signedIn
          ? "Preview · verified achievements need a cloud account"
          : summary
            ? `${unlocked.size} of ${AVAILABLE_ACHIEVEMENTS.length} unlocked · verified by the server`
            : "Verified by the server"
      }
    >
      {!signedIn && (
        <p className="mb-3 rounded-lg border border-line bg-white/3 px-3 py-2 text-xs text-fg-muted">
          Guest practice doesn&apos;t earn achievements. Sign in from Account above to start your verified record.
          {onSignIn && (
            <button type="button" onClick={onSignIn} className="ml-1 text-accent hover:underline">
              Sign in
            </button>
          )}
        </p>
      )}
      {signedIn && career.status === "ready" && !summary && (
        <p role="status" className="mb-3 text-xs text-warning">
          Achievements couldn&apos;t be loaded right now. They&apos;ll appear the next time your career refreshes.
        </p>
      )}

      <div role="group" aria-label="Achievement category" className="mb-3 flex flex-wrap gap-1 rounded-lg bg-white/5 p-0.5 ring-1 ring-line ring-inset">
        {(["all", ...ACHIEVEMENT_CATEGORIES] as const).map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
            className="rounded-md px-2.5 py-1 text-xs font-medium text-fg-muted aria-pressed:bg-surface-hover aria-pressed:text-fg"
          >
            {key === "all" ? "All" : CATEGORY_LABELS[key]}
          </button>
        ))}
      </div>

      <ul className="grid gap-2 @lg:grid-cols-2">
        {visible.map((achievement) => {
          const unlock = unlocked.get(achievement.id);
          const progress = summary?.progress[achievement.id];
          const future = achievement.status === "future";
          return (
            <li
              key={achievement.id}
              className={cn("flex gap-3 rounded-lg border p-3", unlock ? "border-gold/30 bg-gold-soft" : future ? "border-dashed border-line bg-white/1" : "border-line bg-white/2")}
            >
              <span
                aria-hidden="true"
                className={cn("grid size-8 shrink-0 place-items-center rounded-lg", unlock ? "bg-gold/20 text-gold" : "bg-white/5 text-fg-subtle")}
              >
                {unlock ? <AchievementGlyph icon={achievement.icon} className="size-4" /> : <LockIcon className="size-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className={cn("flex flex-wrap items-center gap-1.5 text-[13px] font-medium", !unlock && "text-fg-muted")}>
                  {achievement.name}
                  <Badge tone={RARITY[achievement.rarity].tone}>{RARITY[achievement.rarity].label}</Badge>
                  <span className="sr-only">{unlock ? " (unlocked)" : future ? " (coming later)" : " (locked)"}</span>
                </p>
                <p className="text-xs text-fg-subtle">{achievement.description}</p>
                {unlock ? (
                  <p className="mt-1 text-[11px] text-gold">Unlocked {formatTimestampDate(unlock.unlockedAt)}</p>
                ) : future ? (
                  <p className="mt-1 text-[11px] text-fg-subtle">Coming later: this mechanic doesn&apos;t exist yet.</p>
                ) : signedIn && progress ? (
                  <div className="mt-1.5 flex items-center gap-2">
                    <ProgressBar value={progress.current} max={progress.target} label={`${achievement.name} progress`} size="sm" className="flex-1" />
                    <span className="text-[11px] text-fg-subtle tabular-nums">
                      {progress.current} / {progress.target}
                    </span>
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
