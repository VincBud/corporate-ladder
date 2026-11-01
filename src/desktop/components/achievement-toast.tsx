"use client";

import { useEffect, useEffectEvent } from "react";
import { getAchievement } from "@/career/achievements";
import { CloseIcon } from "@/components/icons";
import type { AchievementUnlock } from "@/types/achievements";
import { AchievementGlyph } from "@/apps/achievements/achievement-icon";

const AUTO_DISMISS_MS = 7_000;

/** Lightweight achievement notice. Shown only between rounds, one at a time. */
export function AchievementToast({ unlock, onDismiss, onOpen }: { unlock: AchievementUnlock; onDismiss: () => void; onOpen: () => void }) {
  const dismiss = useEffectEvent(onDismiss);
  const achievement = getAchievement(unlock.id);

  useEffect(() => {
    const id = window.setTimeout(() => dismiss(), AUTO_DISMISS_MS);
    return () => window.clearTimeout(id);
  }, [unlock.id]);

  return (
    <div
      role="status"
      aria-label="Achievement unlocked"
      className="absolute top-20 left-1/2 z-[949] flex w-[min(24rem,calc(100%-2rem))] -translate-x-1/2 items-start gap-3 rounded-xl border border-gold/40 bg-desk-900/95 p-3.5 shadow-popover motion-safe:animate-pop-in"
    >
      <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-lg bg-gold-soft text-gold">
        <AchievementGlyph icon={achievement.icon} className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium tracking-wider text-gold uppercase">Achievement unlocked</p>
        <p className="text-[13px] font-semibold">{achievement.name}</p>
        <p className="mt-0.5 text-xs text-fg-muted">{achievement.description}</p>
        <button
          type="button"
          onClick={() => {
            onOpen();
            onDismiss();
          }}
          className="mt-1.5 text-xs font-medium text-accent hover:underline"
        >
          View achievements
        </button>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss achievement notice"
        className="grid size-7 shrink-0 place-items-center rounded-md text-fg-muted transition-colors hover:bg-white/8 hover:text-fg"
      >
        <CloseIcon className="size-4" />
      </button>
    </div>
  );
}
