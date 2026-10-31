"use client";

import { useEffect, useEffectEvent } from "react";
import type { ProgressChange } from "@/career/progression";
import { CloseIcon, LadderIcon } from "@/components/icons";
import { formatSalary } from "@/lib/format";

const AUTO_DISMISS_MS = 9_000;

/** Lightweight promotion notice. Not a Quarterly Performance Review. */
export function PromotionToast({ change, onDismiss }: { change: ProgressChange; onDismiss: () => void }) {
  const dismiss = useEffectEvent(onDismiss);

  useEffect(() => {
    const id = window.setTimeout(() => dismiss(), AUTO_DISMISS_MS);
    return () => window.clearTimeout(id);
  }, [change]);

  return (
    <div
      role="status"
      className="absolute top-4 left-1/2 z-[950] flex w-[min(24rem,calc(100%-2rem))] -translate-x-1/2 animate-pop-in items-start gap-3 rounded-xl border border-gold/40 bg-desk-900/95 p-3.5 shadow-popover"
    >
      <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-lg bg-gold-soft text-gold">
        <LadderIcon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium tracking-wider text-gold uppercase">Promotion</p>
        <p className="text-[13px] font-semibold">
          {change.rankBefore.title} → {change.rankAfter.title}
        </p>
        <p className="mt-0.5 text-xs text-fg-muted">
          New salary {formatSalary(change.rankAfter.salary)}/yr. {change.rankAfter.perk}
        </p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss promotion notice"
        className="grid size-7 shrink-0 place-items-center rounded-md text-fg-muted transition-colors hover:bg-white/8 hover:text-fg"
      >
        <CloseIcon className="size-4" />
      </button>
    </div>
  );
}
