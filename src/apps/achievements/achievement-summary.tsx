"use client";

import { Panel } from "@/components/ui/panel";
import { getAchievement } from "@/career/achievements";
import { formatTimestampDate } from "@/lib/format";
import type { CareerState } from "@/performance/career-store";
import { AchievementGlyph } from "./achievement-icon";
import { AVAILABLE_ACHIEVEMENTS } from "./achievements-panel";

/** Compact achievement summary for Corporate Career; details live in Employee Profile. */
export function AchievementSummary({ career, onOpen }: { career: CareerState; onOpen: () => void }) {
  const unlocked = career.achievements?.unlocked ?? [];
  const latest = [...unlocked].sort((a, b) => b.unlockedAt.localeCompare(a.unlockedAt)).slice(0, 3);
  return (
    <Panel title="Achievements" description={career.source === "cloud" ? `${unlocked.length} of ${AVAILABLE_ACHIEVEMENTS.length} unlocked` : "Verified achievements need an account"}>
      {latest.length > 0 ? (
        <ul className="space-y-1.5">
          {latest.map((u) => (
            <li key={u.id} className="flex items-center gap-2 text-xs">
              <span aria-hidden="true" className="grid size-6 place-items-center rounded-md bg-gold/20 text-gold">
                <AchievementGlyph icon={getAchievement(u.id).icon} className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1 truncate">{getAchievement(u.id).name}</span>
              <span className="text-fg-subtle tabular-nums">{formatTimestampDate(u.unlockedAt)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-fg-subtle">{career.source === "cloud" ? "None yet. Your first verified round unlocks one." : "Play signed in to start earning them."}</p>
      )}
      <button
        type="button"
        onClick={onOpen}
        className="mt-3 w-full rounded-lg bg-white/6 px-3 py-1.5 text-xs font-medium text-fg ring-1 ring-line transition-colors ring-inset hover:bg-white/10"
      >
        View all achievements
      </button>
    </Panel>
  );
}
